use dp_thumbs::{render_edge_for_slot, ThumbChain, ThumbStore, PREVIEW_SLOT, THUMB_SIZES};
fn fx(n: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(n)
}
fn tool(n: &str) -> bool {
    which::which(n).is_ok()
}
#[tokio::test]
async fn jpg_and_png_resize_to_max_edge() {
    let c = ThumbChain::default_chain();
    for (f, e) in [("sample.jpg", "jpg"), ("sample.png", "png")] {
        let img = c.render(&fx(f), e, 400).await.unwrap();
        assert_eq!(img.width().max(img.height()), 400);
    }
}
#[tokio::test]
async fn heic_via_sips() {
    let img = ThumbChain::default_chain()
        .render(&fx("sample.heic"), "heic", 400)
        .await
        .unwrap();
    assert_eq!(img.width(), 400);
}
#[tokio::test]
async fn video_via_ffmpeg() {
    if !tool("ffmpeg") {
        eprintln!("skipping: ffmpeg not installed");
        return;
    }
    let img = ThumbChain::default_chain()
        .render(&fx("sample.mp4"), "mp4", 400)
        .await
        .unwrap();
    assert_eq!(img.width(), 400);
}
#[tokio::test]
async fn raw_via_exiftool_preview_if_present() {
    let p = fx("sample.raf");
    if !p.exists() || !tool("exiftool") {
        eprintln!("skipping: sample.raf fixture or exiftool not present");
        return;
    }
    let img = ThumbChain::default_chain().render(&p, "raf", 2000).await.unwrap();
    assert!(img.width() >= 1000);
}
#[tokio::test]
async fn unsupported_ext_errors() {
    assert!(ThumbChain::default_chain()
        .render(&fx("sample.jpg"), "txt", 400)
        .await
        .is_err());
}
#[tokio::test]
async fn store_writes_webp_under_hash() {
    let dir = tempfile::tempdir().unwrap();
    let st = ThumbStore::new(dir.path());
    let img = image::RgbImage::from_pixel(8, 8, image::Rgb([200, 10, 10]));
    let p = st.write("abc", THUMB_SIZES[0], &img).await.unwrap();
    assert!(p.ends_with("abc/400.webp") && p.exists() && st.exists("abc", 400));
}

/// The core of the slot/render-edge decoupling: whatever pixel edge is
/// actually rendered for the preview slot (parametrized by the quality
/// setting via `render_edge_for_slot`), the file written by `store.write`
/// always lands at the fixed `2000.webp` filename — never renamed to
/// match the edge actually rendered.
#[tokio::test]
async fn preview_slot_filename_stays_2000_webp_regardless_of_render_edge() {
    let dir = tempfile::tempdir().unwrap();
    let st = ThumbStore::new(dir.path());
    let img = image::RgbImage::from_pixel(1600, 1600, image::Rgb([10, 20, 30]));

    let render_edge = render_edge_for_slot(PREVIEW_SLOT, 1200);
    assert_eq!(render_edge, 1200);
    let resized = dp_thumbs::resize_fit(img, render_edge);
    assert_eq!(resized.width().max(resized.height()), 1200);

    let p = st.write("hash1", PREVIEW_SLOT, &resized).await.unwrap();
    assert!(p.ends_with("hash1/2000.webp"));
    assert!(st.exists("hash1", 2000));
}

#[tokio::test]
async fn list_hashes_is_empty_when_the_store_root_does_not_exist_yet() {
    let dir = tempfile::tempdir().unwrap();
    let st = ThumbStore::new(dir.path().join("never-created"));
    assert!(st.list_hashes().await.unwrap().is_empty());
}

#[tokio::test]
async fn list_hashes_lists_every_hash_directory_under_the_root() {
    let dir = tempfile::tempdir().unwrap();
    let st = ThumbStore::new(dir.path());
    let img = image::RgbImage::from_pixel(4, 4, image::Rgb([1, 2, 3]));
    st.write("hash-a", 400, &img).await.unwrap();
    st.write("hash-b", 400, &img).await.unwrap();

    let mut hashes = st.list_hashes().await.unwrap();
    hashes.sort();
    assert_eq!(hashes, vec!["hash-a".to_string(), "hash-b".to_string()]);
}

#[tokio::test]
async fn regen_preview_is_a_no_op_when_no_preview_slot_exists_for_the_hash() {
    let dir = tempfile::tempdir().unwrap();
    let st = ThumbStore::new(dir.path());
    assert_eq!(st.regen_preview("missing", 800).await.unwrap(), None);
}

#[tokio::test]
async fn regen_preview_downscales_a_larger_cached_preview_in_place() {
    let dir = tempfile::tempdir().unwrap();
    let st = ThumbStore::new(dir.path());
    let big = image::RgbImage::from_pixel(2000, 1500, image::Rgb([200, 50, 10]));
    st.write("abc", PREVIEW_SLOT, &big).await.unwrap();

    let result = st.regen_preview("abc", 800).await.unwrap();
    assert!(result.is_some());
    let (old_bytes, new_bytes) = result.unwrap();
    assert!(old_bytes > 0 && new_bytes > 0);

    let decoded = image::open(st.path("abc", PREVIEW_SLOT)).unwrap().to_rgb8();
    assert_eq!(decoded.width().max(decoded.height()), 800);
}

#[tokio::test]
async fn regen_preview_never_upscales_an_already_small_preview() {
    let dir = tempfile::tempdir().unwrap();
    let st = ThumbStore::new(dir.path());
    let small = image::RgbImage::from_pixel(400, 300, image::Rgb([5, 5, 5]));
    st.write("abc", PREVIEW_SLOT, &small).await.unwrap();

    let result = st.regen_preview("abc", 2000).await.unwrap();
    assert_eq!(result, None);

    let decoded = image::open(st.path("abc", PREVIEW_SLOT)).unwrap().to_rgb8();
    assert_eq!(decoded.width().max(decoded.height()), 400);
}

#[tokio::test]
async fn regen_preview_never_touches_the_400px_thumb_slot() {
    let dir = tempfile::tempdir().unwrap();
    let st = ThumbStore::new(dir.path());
    let thumb = image::RgbImage::from_pixel(400, 400, image::Rgb([9, 9, 9]));
    let preview = image::RgbImage::from_pixel(2000, 2000, image::Rgb([9, 9, 9]));
    st.write("abc", 400, &thumb).await.unwrap();
    st.write("abc", PREVIEW_SLOT, &preview).await.unwrap();

    st.regen_preview("abc", 800).await.unwrap();

    let decoded_thumb = image::open(st.path("abc", 400)).unwrap().to_rgb8();
    assert_eq!(decoded_thumb.width().max(decoded_thumb.height()), 400);
}

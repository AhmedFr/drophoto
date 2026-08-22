use dp_thumbs::{ThumbChain, ThumbStore, THUMB_SIZES};
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

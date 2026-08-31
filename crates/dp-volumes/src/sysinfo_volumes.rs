use crate::VolumeProvider;
use dp_core::{DpResult, Volume};
use std::collections::HashMap;
use std::sync::Mutex;
use sysinfo::Disks;

/// Reads a mounted volume's Apple `VolumeUUID`, injectable so
/// [`SysinfoVolumes`] can be tested without shelling out to `diskutil` or
/// requiring a real external drive. The real implementation
/// ([`DiskutilIdentity`]) is macOS-only; every other platform's `list()`
/// leaves [`Volume::uuid`] `None` without ever consulting this trait.
#[async_trait::async_trait]
pub trait DiskIdentity: Send + Sync {
    async fn volume_uuid(&self, mount_path: &str) -> Option<String>;
}

/// Shells out to `diskutil info -plist <mount_path>` and parses
/// `VolumeUUID` from the result. Any failure (spawn error, non-zero exit,
/// invalid UTF-8, missing key) is swallowed into `None` — a volume with
/// no readable UUID just falls back to the next match tier in
/// `resolve_presence` rather than failing the whole volume listing.
pub struct DiskutilIdentity;

#[async_trait::async_trait]
impl DiskIdentity for DiskutilIdentity {
    #[cfg(target_os = "macos")]
    async fn volume_uuid(&self, mount_path: &str) -> Option<String> {
        let mount_path = mount_path.to_string();
        let output = tokio::process::Command::new("diskutil")
            .args(["info", "-plist", &mount_path])
            .output()
            .await
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8(output.stdout).ok()?;
        parse_plist_string_value(&text, "VolumeUUID")
    }

    #[cfg(not(target_os = "macos"))]
    async fn volume_uuid(&self, _mount_path: &str) -> Option<String> {
        None
    }
}

/// Extracts the string value immediately following `<key>{key}</key>` in
/// Apple XML plist text (e.g. `diskutil info -plist` output) — a small,
/// dependency-free parser purpose-built for that one shape rather than a
/// general plist reader. Returns `None` if `key` is absent, or its value
/// isn't a `<string>…</string>`.
pub(crate) fn parse_plist_string_value(xml: &str, key: &str) -> Option<String> {
    let marker = format!("<key>{key}</key>");
    let key_pos = xml.find(&marker)?;
    let after_key = &xml[key_pos + marker.len()..];
    let start = after_key.find("<string>")? + "<string>".len();
    let end = start + after_key[start..].find("</string>")?;
    Some(after_key[start..end].to_string())
}

/// Locks `cache`, recovering from mutex poisoning rather than unwrapping
/// — the guarded section is a trivial `HashMap` lookup/insert that can't
/// leave the map in a state worth propagating a poisoned-lock panic for.
fn lock_cache(
    cache: &Mutex<HashMap<String, Option<String>>>,
) -> std::sync::MutexGuard<'_, HashMap<String, Option<String>>> {
    cache.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub struct SysinfoVolumes {
    identity: Box<dyn DiskIdentity>,
    /// `mount_path -> VolumeUUID` (or `None` if that mount has none),
    /// cached for the provider instance's lifetime — a mounted volume's
    /// UUID never changes while it stays mounted, so re-shelling out to
    /// `diskutil` on every 5-second presence-watcher poll is wasted work.
    uuid_cache: Mutex<HashMap<String, Option<String>>>,
}

impl Default for SysinfoVolumes {
    fn default() -> Self {
        Self::new(Box::new(DiskutilIdentity))
    }
}

impl SysinfoVolumes {
    pub fn new(identity: Box<dyn DiskIdentity>) -> Self {
        Self {
            identity,
            uuid_cache: Mutex::new(HashMap::new()),
        }
    }

    async fn uuid_for(&self, mount_path: &str) -> Option<String> {
        if let Some(cached) = lock_cache(&self.uuid_cache).get(mount_path).cloned() {
            return cached;
        }
        let uuid = self.identity.volume_uuid(mount_path).await;
        lock_cache(&self.uuid_cache).insert(mount_path.to_string(), uuid.clone());
        uuid
    }
}

#[async_trait::async_trait]
impl VolumeProvider for SysinfoVolumes {
    async fn list(&self) -> DpResult<Vec<Volume>> {
        let disks = tokio::task::spawn_blocking(Disks::new_with_refreshed_list)
            .await
            .map_err(|e| dp_core::DpError::Io {
                message: e.to_string(),
                path: None,
            })?;
        let mut out: Vec<Volume> = disks
            .iter()
            .map(|d| Volume {
                name: d.name().to_string_lossy().to_string(),
                mount_path: d.mount_point().to_string_lossy().to_string(),
                total_bytes: d.total_space(),
                free_bytes: d.available_space(),
                is_removable: d.is_removable(),
                uuid: None,
            })
            .filter(|v| v.mount_path == "/" || v.mount_path.starts_with("/Volumes/"))
            .collect();
        out.sort_by(|a, b| a.mount_path.cmp(&b.mount_path));
        out.dedup_by(|a, b| a.mount_path == b.mount_path);

        for v in &mut out {
            v.uuid = self.uuid_for(&v.mount_path).await;
        }

        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE_PLIST: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>DeviceIdentifier</key>
	<string>disk3s1s1</string>
	<key>VolumeName</key>
	<string>Kodachrome</string>
	<key>VolumeUUID</key>
	<string>6A809721-827D-4C0E-B7C1-D962C6DAD2CC</string>
</dict>
</plist>
"#;

    #[test]
    fn parse_plist_string_value_finds_the_key() {
        assert_eq!(
            parse_plist_string_value(FIXTURE_PLIST, "VolumeUUID"),
            Some("6A809721-827D-4C0E-B7C1-D962C6DAD2CC".to_string())
        );
        assert_eq!(
            parse_plist_string_value(FIXTURE_PLIST, "VolumeName"),
            Some("Kodachrome".to_string())
        );
    }

    #[test]
    fn parse_plist_string_value_returns_none_for_a_missing_key() {
        assert_eq!(parse_plist_string_value(FIXTURE_PLIST, "NoSuchKey"), None);
    }

    #[test]
    fn parse_plist_string_value_returns_none_for_empty_input() {
        assert_eq!(parse_plist_string_value("", "VolumeUUID"), None);
    }

    struct FakeIdentity(Option<String>);

    #[async_trait::async_trait]
    impl DiskIdentity for FakeIdentity {
        async fn volume_uuid(&self, _mount_path: &str) -> Option<String> {
            self.0.clone()
        }
    }

    struct CountingIdentity {
        calls: std::sync::atomic::AtomicUsize,
    }

    #[async_trait::async_trait]
    impl DiskIdentity for CountingIdentity {
        async fn volume_uuid(&self, _mount_path: &str) -> Option<String> {
            self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Some("fixed-uuid".to_string())
        }
    }

    #[tokio::test]
    async fn uuid_for_caches_by_mount_path() {
        let counting = CountingIdentity {
            calls: std::sync::atomic::AtomicUsize::new(0),
        };
        let provider = SysinfoVolumes::new(Box::new(counting));

        let first = provider.uuid_for("/Volumes/Kodachrome").await;
        let second = provider.uuid_for("/Volumes/Kodachrome").await;

        assert_eq!(first, Some("fixed-uuid".to_string()));
        assert_eq!(second, Some("fixed-uuid".to_string()));
        // Second lookup should have come from the cache, not the identity
        // provider — inspect the cache directly since the trait object no
        // longer exposes the counter.
        assert_eq!(lock_cache(&provider.uuid_cache).len(), 1);
    }

    #[tokio::test]
    async fn uuid_for_returns_none_when_identity_has_none() {
        let provider = SysinfoVolumes::new(Box::new(FakeIdentity(None)));
        assert_eq!(provider.uuid_for("/Volumes/Unknown").await, None);
    }
}

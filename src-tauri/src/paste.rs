#[cfg(target_os = "macos")]
use core_foundation::base::TCFType;
#[cfg(target_os = "macos")]
use core_foundation::boolean::CFBoolean;
#[cfg(target_os = "macos")]
use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
#[cfg(target_os = "macos")]
use core_foundation::string::{CFString, CFStringRef};
#[cfg(target_os = "macos")]
use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
#[cfg(target_os = "macos")]
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_app_kit::NSApplication;

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
    static kAXTrustedCheckOptionPrompt: CFStringRef;
}

/// Check the macOS Accessibility permission used to synthesize Command+V and
/// ask TCC to register this application in the Accessibility settings pane.
#[cfg(target_os = "macos")]
pub fn ensure_post_event_access() -> Result<(), String> {
    let trusted = unsafe {
        let prompt_key = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt);
        let options = CFDictionary::from_CFType_pairs(&[(prompt_key, CFBoolean::true_value())]);
        AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef())
    };
    if trusted {
        Ok(())
    } else {
        Err(
            "Click-to-paste needs Accessibility access. Enable Edge Drop in System Settings → Privacy & Security → Accessibility, then try again."
                .to_string(),
        )
    }
}

#[cfg(target_os = "macos")]
pub fn open_accessibility_settings() -> Result<(), String> {
    let status = std::process::Command::new("/usr/bin/open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .status()
        .map_err(|error| format!("could not open Accessibility settings: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("macOS could not open Accessibility settings".to_string())
    }
}

#[cfg(not(target_os = "macos"))]
pub fn open_accessibility_settings() -> Result<(), String> {
    Err("Accessibility settings are only available on macOS".to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn ensure_post_event_access() -> Result<(), String> {
    Err("click-to-paste is currently implemented for macOS only".to_string())
}

/// Hide the application so macOS restores the previously active app before
/// the paste shortcut is posted. Unhiding without activation keeps that app in
/// front while restoring Edge Drop's background edge window and menu item.
pub async fn set_application_hidden(
    window: &tauri::WebviewWindow,
    hidden: bool,
) -> Result<(), String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            #[cfg(target_os = "macos")]
            {
                let result = MainThreadMarker::new()
                    .ok_or_else(|| "macOS application access requires the main thread".to_string())
                    .map(|marker| {
                        let application = NSApplication::sharedApplication(marker);
                        if hidden {
                            application.hide(None);
                        } else {
                            application.unhideWithoutActivation();
                        }
                    });
                let _ = sender.send(result);
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = sender.send(Ok(()));
            }
        })
        .map_err(|error| error.to_string())?;
    receiver
        .await
        .map_err(|_| "application visibility update was interrupted".to_string())?
}

#[cfg(target_os = "macos")]
pub fn post_paste_shortcut() -> Result<(), String> {
    // ANSI virtual key code 9 is the V key on macOS. Command is expressed as
    // an event flag so this remains independent of the user's keyboard layout.
    const V_KEY: u16 = 9;
    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| "macOS could not create a keyboard event source".to_string())?;
    let key_down = CGEvent::new_keyboard_event(source.clone(), V_KEY, true)
        .map_err(|_| "macOS could not create the paste key-down event".to_string())?;
    let key_up = CGEvent::new_keyboard_event(source, V_KEY, false)
        .map_err(|_| "macOS could not create the paste key-up event".to_string())?;
    key_down.set_flags(CGEventFlags::CGEventFlagCommand);
    key_up.set_flags(CGEventFlags::CGEventFlagCommand);
    key_down.post(CGEventTapLocation::HID);
    key_up.post(CGEventTapLocation::HID);
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn post_paste_shortcut() -> Result<(), String> {
    Err("click-to-paste is currently implemented for macOS only".to_string())
}

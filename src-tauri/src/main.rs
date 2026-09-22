// Keep the console window from appearing behind the app on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ascii_writer_lib::run()
}

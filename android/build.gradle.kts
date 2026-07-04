// Top-level build file — plugin versions declared here, applied per-module.
// Mirrors the movies (Kinowo) app's toolchain: AGP 9 ships built-in Kotlin
// support, so there's no standalone `org.jetbrains.kotlin.android` plugin — the
// compose + serialization compiler plugins pin the Kotlin version (2.4.0).
plugins {
    id("com.android.application") version "9.2.1" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.0" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.4.0" apply false
}

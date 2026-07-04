import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "pl.filmowo"
    compileSdk = 37

    defaultConfig {
        // The Play Store package id. Distinct from `namespace` (the Kotlin
        // package `pl.filmowo`) exactly like the movies app keeps
        // `net.pawel.kinowo` separate from `pl.kinowo`.
        applicationId = "net.pawel.filmowo"
        minSdk = 26
        targetSdk = 37
        versionCode = System.getenv("FILMOWO_VERSION_CODE")?.toIntOrNull() ?: 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Where the app talks to. Defaults to prod; point a debug build at a
        // local server (with ALLOW_DEV_LOGIN=1) via the FILMOWO_BASE_URL env var,
        // e.g. FILMOWO_BASE_URL=http://10.0.2.2:3000 for the emulator's host.
        val baseUrl = System.getenv("FILMOWO_BASE_URL") ?: "https://filmowo.fly.dev"
        buildConfigField("String", "BASE_URL", "\"$baseUrl\"")
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
        // The build the DevPanel installs over cable: the release build type (so
        // it's a non-debug, non-debuggable build) but with R8/resource shrinking
        // OFF so it builds fast for a local smoke test, and signed with the
        // auto-managed debug keystore so it actually installs without a release
        // keystore (this variant is never shipped). Mirrors the movies app's
        // `releaseFast`. A `src/releaseFast` manifest overlay re-enables cleartext
        // so it can still reach the local dev server (see that file).
        create("releaseFast") {
            initWith(getByName("release"))
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    testOptions {
        unitTests {
            isReturnDefaultValues = true
            // Robolectric needs the merged resources/manifest on the JVM
            // classpath to construct a Context off-device.
            isIncludeAndroidResources = true
        }
    }
    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

// AGP 9 removed `android.kotlinOptions`; Kotlin compiler settings live on the
// Kotlin Gradle extension's `compilerOptions`.
kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_17
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.06.00")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.core:core-ktx:1.19.0")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")

    implementation("androidx.navigation:navigation-compose:2.9.8")

    // Custom Tabs for the web OAuth sign-in — an in-app browser tab that shares
    // no cookies with the app, so sign-in completes via the filmowo:// deep link
    // + one-shot exchange code (see AuthRepository).
    implementation("androidx.browser:browser:1.10.0")

    implementation("io.coil-kt:coil-compose:2.7.0")

    implementation("com.squareup.okhttp3:okhttp:5.4.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")

    implementation("androidx.datastore:datastore-preferences:1.2.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
    // Replays canned server responses so the API client + ViewModel are tested
    // without a live server (the movies app's MockWebServer pattern).
    testImplementation("com.squareup.okhttp3:mockwebserver:5.4.0")
    // JVM (off-device) Android tests via Robolectric — a real Context for the
    // cookie jar / DataStore round-trips without an emulator.
    testImplementation(composeBom)
    testImplementation("org.robolectric:robolectric:4.16.1")
    testImplementation("androidx.compose.ui:ui-test-junit4")
    testImplementation("androidx.test:core-ktx:1.7.0")

    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

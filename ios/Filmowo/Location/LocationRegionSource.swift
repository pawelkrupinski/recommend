import Foundation
import CoreLocation
import FilmowoCore

/// The app's region source: Core's `RegionSource` (a `best()` country) plus a
/// one-shot GPS refine. A seam so previews/tests can supply a fake without
/// CoreLocation.
protocol AppRegionSource: RegionSource {
    @discardableResult
    func resolveGPS(geocode: (Double, Double) async throws -> String?) async -> String?
}

/// The device's streaming REGION, resolved most-precise-first: a one-shot GPS
/// fix (once the user grants permission), geocoded to a country by the server,
/// else the device-locale region. Mirrors Android `DeviceRegion` — deliberately
/// about location, not language. The GPS result is cached and layered on top of
/// the locale fallback via the pure `RegionResolver.pickCountry`.
final class LocationRegionSource: NSObject, AppRegionSource, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var gpsCountry: String?
    private var fixContinuation: CheckedContinuation<CLLocation?, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    func best() -> String? {
        RegionResolver.pickCountry(gpsCountry, Locale.current.region?.identifier)
    }

    /// Request permission, take one fix, geocode it via the server, and cache the
    /// resulting country as the top-priority override. Best-effort: returns the
    /// resolved code or nil, never throws, and changes nothing on failure.
    @discardableResult
    func resolveGPS(geocode: (Double, Double) async throws -> String?) async -> String? {
        guard CLLocationManager.locationServicesEnabled() else { return nil }
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
        }
        let status = manager.authorizationStatus
        guard status == .authorizedWhenInUse || status == .authorizedAlways else { return nil }
        guard let loc = await currentFix() else { return nil }
        let country = try? await geocode(loc.coordinate.latitude, loc.coordinate.longitude)
        if let code = RegionResolver.pickCountry(country) {
            gpsCountry = code
            return code
        }
        return nil
    }

    private func currentFix() async -> CLLocation? {
        await withCheckedContinuation { cont in
            fixContinuation = cont
            manager.requestLocation()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        fixContinuation?.resume(returning: locations.last)
        fixContinuation = nil
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        fixContinuation?.resume(returning: nil)
        fixContinuation = nil
    }
}

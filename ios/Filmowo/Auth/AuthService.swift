import UIKit
import AuthenticationServices
import FilmowoCore

/// Drives native OAuth: opens `/auth/<provider>?platform=ios` in an
/// `ASWebAuthenticationSession`, catches the `filmowo://auth-done?code=…` deep
/// link, and redeems the one-shot code at `POST /auth/exchange` — which sets the
/// `rid` cookie on the app's own session and merges any anonymous history.
/// Mirrors Android `AuthRepository`.
@MainActor
final class AuthService: NSObject, ASWebAuthenticationPresentationContextProviding {
    enum AuthError: Error { case cancelled, server(String), noCode }

    /// Sign in with `provider` ("google" | "facebook"). Throws `.cancelled` if
    /// the user dismisses the sheet. On success the client holds a real session.
    func signIn(provider: String, client: FilmowoClient) async throws {
        let callback = try await authenticate(url: client.authStartURL(provider: provider))
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let error = items.first(where: { $0.name == "error" })?.value {
            throw AuthError.server(error)
        }
        guard let code = items.first(where: { $0.name == "code" })?.value else { throw AuthError.noCode }
        try await client.exchange(code: code)
    }

    private func authenticate(url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { cont in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "filmowo") { callbackURL, error in
                if let callbackURL {
                    cont.resume(returning: callbackURL)
                } else if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin {
                    cont.resume(throwing: AuthError.cancelled)
                } else {
                    cont.resume(throwing: error ?? AuthError.cancelled)
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            if !session.start() { cont.resume(throwing: AuthError.cancelled) }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scene = UIApplication.shared.connectedScenes.first { $0.activationState == .foregroundActive } as? UIWindowScene
        return scene?.keyWindow ?? ASPresentationAnchor()
    }
}

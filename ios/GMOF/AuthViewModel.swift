import SwiftUI

@Observable
class AuthViewModel {
    var currentUser: AuthUser?
    var token: String?
    var isLoading: Bool = false
    var loginError: String?

    var isAuthenticated: Bool { token != nil && currentUser != nil }

    init() {
        Task { await restoreSession() }
    }

    @MainActor
    func login(identifier: String, password: String) async {
        guard !identifier.trimmingCharacters(in: .whitespaces).isEmpty,
              !password.isEmpty else {
            loginError = "Please enter your email/username and password."
            return
        }

        isLoading = true
        loginError = nil

        do {
            let response = try await AuthService.shared.login(
                identifier: identifier.trimmingCharacters(in: .whitespaces),
                password: password
            )
            Keychain.saveToken(response.token)
            self.token = response.token
            self.currentUser = response.user
        } catch let error as AuthError {
            loginError = error.errorDescription
        } catch {
            loginError = "Could not connect to the server. Check your connection and try again."
        }

        isLoading = false
    }

    @MainActor
    func logout() {
        Keychain.deleteToken()
        token = nil
        currentUser = nil
        loginError = nil
    }

    private func restoreSession() async {
        guard let saved = Keychain.loadToken() else { return }
        do {
            let user = try await AuthService.shared.fetchMe(token: saved)
            await MainActor.run {
                self.token = saved
                self.currentUser = user
            }
        } catch {
            Keychain.deleteToken()
        }
    }
}

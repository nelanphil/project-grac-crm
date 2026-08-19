import Foundation
import Security

// MARK: - Models

struct AuthUser: Codable, Sendable {
    let id: String
    let email: String
    let firstName: String
    let lastName: String
    let role: String
    let permissions: [String]
    let needsLegalConsent: Bool

    enum CodingKeys: String, CodingKey {
        case id, email, role, permissions, needsLegalConsent
        case firstName = "first_name"
        case lastName = "last_name"
    }

    var fullName: String { "\(firstName) \(lastName)" }
}

struct LoginResponse: Codable, Sendable {
    let token: String
    let user: AuthUser
}

// MARK: - Auth Errors

enum AuthError: LocalizedError {
    case invalidCredentials
    case ambiguousUsername
    case networkError(String)
    case decodingError
    case unknown

    var errorDescription: String? {
        switch self {
        case .invalidCredentials:
            return "Invalid email/username or password."
        case .ambiguousUsername:
            return "This username is shared. Sign in with your username and number (e.g. doc1), or use your email."
        case .networkError(let msg):
            return msg
        case .decodingError:
            return "Unexpected server response."
        case .unknown:
            return "An unknown error occurred."
        }
    }
}

// MARK: - Keychain

enum Keychain {
    private static let service = "com.gmof.crm"
    private static let tokenAccount = "authToken"

    static func saveToken(_ token: String) {
        let data = Data(token.utf8)
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: tokenAccount,
        ]
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData] = data
        SecItemAdd(item as CFDictionary, nil)
    }

    static func loadToken() -> String? {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: tokenAccount,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess,
              let data = result as? Data,
              let token = String(data: data, encoding: .utf8)
        else { return nil }
        return token
    }

    static func deleteToken() {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: tokenAccount,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

// MARK: - AuthService

actor AuthService {
    static let shared = AuthService()

    #if DEBUG
    private let baseURL = URL(string: "http://localhost:4009")!
    #else
    private let baseURL = URL(string: "https://gmof-server.onrender.com")!
    #endif

    func login(identifier: String, password: String) async throws -> LoginResponse {
        let url = baseURL.appendingPathComponent("auth/login")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["identifier": identifier, "password": password])

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse else {
            throw AuthError.networkError("No HTTP response.")
        }

        let rawBody = String(data: data, encoding: .utf8) ?? "<non-utf8>"
        print("[AuthService] POST /auth/login → HTTP \(http.statusCode)")
        print("[AuthService] Response body: \(rawBody)")

        switch http.statusCode {
        case 200:
            do {
                return try JSONDecoder().decode(LoginResponse.self, from: data)
            } catch let decodeError {
                print("[AuthService] Decode error: \(decodeError)")
                throw AuthError.decodingError
            }
        case 401:
            // Check if it's the ambiguous username error
            if let body = try? JSONDecoder().decode([String: String].self, from: data),
               body["message"]?.contains("shared") == true {
                throw AuthError.ambiguousUsername
            }
            throw AuthError.invalidCredentials
        default:
            let msg = (try? JSONDecoder().decode([String: String].self, from: data))?["message"] ?? "Server error \(http.statusCode)."
            throw AuthError.networkError(msg)
        }
    }

    func fetchMe(token: String) async throws -> AuthUser {
        let url = baseURL.appendingPathComponent("auth/me")
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw AuthError.invalidCredentials
        }

        struct MeResponse: Codable { let user: AuthUser }
        return try JSONDecoder().decode(MeResponse.self, from: data).user
    }
}

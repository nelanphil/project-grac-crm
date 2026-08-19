import Foundation

enum APIError: LocalizedError {
    case httpError(Int, String?)
    case unauthorized
    case decodingError(Error)

    var errorDescription: String? {
        switch self {
        case .httpError(let code, let msg): return msg ?? "Server error \(code)."
        case .unauthorized:                 return "Session expired. Please sign in again."
        case .decodingError:                return "Unexpected response from server."
        }
    }
}

actor APIClient {
    static let shared = APIClient()

    private var baseURL: URL {
        #if DEBUG
        URL(string: "http://localhost:4009")!
        #else
        URL(string: "https://gmof-server.onrender.com")!
        #endif
    }

    // MARK: - Core

    private func get<T: Decodable>(
        _ path: String,
        token: String,
        queryItems: [URLQueryItem] = []
    ) async throws -> T {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !queryItems.isEmpty { components.queryItems = queryItems }

        var req = URLRequest(url: components.url!)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.httpError(0, nil) }

        if http.statusCode == 401 { throw APIError.unauthorized }
        guard http.statusCode == 200 else {
            let msg = (try? JSONDecoder().decode([String: String].self, from: data))?["message"]
            throw APIError.httpError(http.statusCode, msg)
        }

        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    // MARK: - Customers

    func customers(
        token: String,
        page: Int = 1,
        pageSize: Int = 25,
        search: String = ""
    ) async throws -> CustomersResponse {
        var q = [URLQueryItem(name: "page", value: "\(page)"),
                 URLQueryItem(name: "pageSize", value: "\(pageSize)")]
        if !search.isEmpty { q.append(URLQueryItem(name: "search", value: search)) }
        return try await get("customers", token: token, queryItems: q)
    }

    // MARK: - Leads

    func leads(
        token: String,
        page: Int = 1,
        search: String = "",
        status: String? = nil
    ) async throws -> LeadsResponse {
        var q = [URLQueryItem(name: "page", value: "\(page)"),
                 URLQueryItem(name: "pageSize", value: "25")]
        if !search.isEmpty { q.append(URLQueryItem(name: "search", value: search)) }
        if let s = status { q.append(URLQueryItem(name: "status", value: s)) }
        return try await get("leads", token: token, queryItems: q)
    }

    // MARK: - Contracts

    func contracts(
        token: String,
        standing: String = "all"
    ) async throws -> ContractsResponse {
        let q = [URLQueryItem(name: "standing", value: standing)]
        return try await get("contracts", token: token, queryItems: q)
    }

    // MARK: - Invoices

    func invoices(
        token: String,
        status: String? = nil,
        customerRef: String? = nil
    ) async throws -> InvoicesResponse {
        var q: [URLQueryItem] = []
        if let s = status     { q.append(URLQueryItem(name: "status",      value: s)) }
        if let c = customerRef { q.append(URLQueryItem(name: "customerRef", value: c)) }
        return try await get("invoices", token: token, queryItems: q)
    }

    func invoiceDetail(id: String, token: String) async throws -> InvoiceDetail {
        let r: InvoiceDetailResponse = try await get("invoices/\(id)", token: token)
        return r.invoice
    }

    // MARK: - Notifications

    func notifications(
        token: String,
        limit: Int = 30,
        before: String? = nil
    ) async throws -> NotificationsResponse {
        var q = [URLQueryItem(name: "limit", value: "\(limit)")]
        if let b = before { q.append(URLQueryItem(name: "before", value: b)) }
        return try await get("notifications", token: token, queryItems: q)
    }

    func notificationsUnreadCount(token: String) async throws -> Int {
        let r: UnreadCountResponse = try await get("notifications/unread-count", token: token)
        return r.count
    }
}

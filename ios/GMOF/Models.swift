import Foundation

// MARK: - Date Formatting

extension String {
    var formattedDate: String {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = iso.date(from: self) { return d.formatted(date: .abbreviated, time: .omitted) }
        iso.formatOptions = [.withInternetDateTime]
        if let d = iso.date(from: self) { return d.formatted(date: .abbreviated, time: .omitted) }
        return self
    }

    var isPastDue: Bool {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = iso.date(from: self) ?? {
            iso.formatOptions = [.withInternetDateTime]
            return iso.date(from: self)
        }()
        guard let date else { return false }
        return date < Date()
    }
}

// MARK: - Customer

struct CustomerListItem: Decodable, Identifiable {
    let id: String
    let accountName: String?
    let first: String
    let last: String
    let phone: String?
    let city: String?
    let state: String?
    let contracts: [ContractBadge]
    let duplicateCount: Int?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case accountName, first, last, phone, city, state, contracts, duplicateCount
    }

    var displayName: String {
        if let a = accountName, !a.isEmpty { return a }
        return "\(first) \(last)".trimmingCharacters(in: .whitespaces)
    }

    var locationText: String? {
        [city, state].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

struct ContractBadge: Decodable, Identifiable {
    let id: String
    let standing: String
    let contractType: String?
    let template: ContractTemplateBadge?

    enum CodingKeys: String, CodingKey {
        case id = "_id"; case standing, contractType, template
    }
}

struct ContractTemplateBadge: Decodable {
    let label: String
}

// MARK: - Lead

struct Lead: Decodable, Identifiable {
    let id: String
    let firstName: String
    let lastName: String
    let email: String?
    let phone: String?
    let city: String?
    let state: String?
    let status: String
    let createdAt: String

    var displayName: String { "\(firstName) \(lastName)" }
    var locationText: String? {
        [city, state].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

// MARK: - Contract

struct Contract: Decodable, Identifiable {
    let id: String
    let description: String
    let standing: String
    let renewalDueDate: String?
    let contractType: String?
    let customer: ContractCustomer?
    let template: ContractTemplateInfo?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case description, standing, renewalDueDate, contractType, customer, template
    }
}

struct ContractCustomer: Decodable {
    let id: String
    let accountName: String?
    let first: String
    let last: String
    let phone: String?

    enum CodingKeys: String, CodingKey {
        case id = "_id"; case accountName, first, last, phone
    }

    var displayName: String {
        if let a = accountName, !a.isEmpty { return a }
        return "\(first) \(last)".trimmingCharacters(in: .whitespaces)
    }
}

struct ContractTemplateInfo: Decodable {
    let label: String
}

// MARK: - Invoice

struct Invoice: Decodable, Identifiable {
    let id: String
    let number: String?
    let amountCents: Int
    let status: String
    let dueDate: String?
    let issuedAt: String
    let paidAt: String?
    let sourceType: String?
    let customerRef: String?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case number, amountCents, status, dueDate, issuedAt, paidAt, sourceType, customerRef
    }

    var amountFormatted: String {
        String(format: "$%.2f", Double(amountCents) / 100.0)
    }

    var isOverdue: Bool {
        status == "open" && (dueDate?.isPastDue ?? false)
    }

    var displayNumber: String {
        number ?? "—"
    }
}

// MARK: - Invoice Detail

struct InvoiceLineItem: Decodable {
    let description: String
    let amountCents: Int

    var amountFormatted: String {
        String(format: "$%.2f", Double(amountCents) / 100.0)
    }
}

struct InvoiceDetailCustomer: Decodable {
    let name: String
    let accountNumber: Int
    let address: String
    let city: String
    let state: String
    let zip: String
    let phone: String
    let email: String

    var fullAddress: String {
        "\(address), \(city), \(state) \(zip)"
    }
}

struct InvoiceDetailServiceAddress: Decodable {
    let label: String?
    let address: String
    let city: String
    let state: String
    let zip: String

    var fullAddress: String {
        "\(address), \(city), \(state) \(zip)"
    }
}

struct InvoiceDetail: Decodable, Identifiable {
    let id: String
    let number: String?
    let amountCents: Int
    let currency: String?
    let status: String
    let dueDate: String?
    let issuedAt: String
    let paidAt: String?
    let sourceType: String?
    let lineItems: [InvoiceLineItem]
    let customer: InvoiceDetailCustomer?
    let serviceAddress: InvoiceDetailServiceAddress?
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case number, amountCents, currency, status, dueDate, issuedAt, paidAt
        case sourceType, lineItems, customer, serviceAddress, createdAt
    }

    var amountFormatted: String {
        String(format: "$%.2f", Double(amountCents) / 100.0)
    }

    var isOverdue: Bool {
        status == "open" && (dueDate?.isPastDue ?? false)
    }

    var displayNumber: String { number ?? "—" }

    var sourceTypeLabel: String {
        switch sourceType {
        case "contract_renewal": return "Contract Renewal"
        case "contract_initial": return "Contract"
        case "work_order":       return "Work Order"
        default:                 return sourceType?.replacingOccurrences(of: "_", with: " ").capitalized ?? "—"
        }
    }
}

struct InvoiceDetailResponse: Decodable {
    let invoice: InvoiceDetail
}

// MARK: - Notification

struct AppNotification: Decodable, Identifiable {
    let id: String
    let summary: String
    let entityType: String?
    let actorName: String?
    let createdAt: String
    let read: Bool
}

// MARK: - API Response Wrappers

struct CustomersResponse: Decodable {
    let customers: [CustomerListItem]
    let total: Int
    let page: Int
    let pageSize: Int
}

struct LeadsResponse: Decodable {
    let leads: [Lead]
    let total: Int
    let page: Int
    let pageSize: Int
}

struct ContractsResponse: Decodable {
    let contracts: [Contract]
}

struct InvoicesResponse: Decodable {
    let invoices: [Invoice]
}

struct NotificationsResponse: Decodable {
    let items: [AppNotification]
    let nextCursor: String?
}

struct UnreadCountResponse: Decodable {
    let count: Int
}

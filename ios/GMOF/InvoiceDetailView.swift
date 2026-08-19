import SwiftUI

// MARK: - ViewModel

@Observable
@MainActor
class InvoiceDetailViewModel {
    var invoice: InvoiceDetail?
    var isLoading = false
    var errorMessage: String?

    func load(id: String, token: String) async {
        isLoading = true
        errorMessage = nil
        do {
            invoice = try await APIClient.shared.invoiceDetail(id: id, token: token)
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        isLoading = false
    }
}

// MARK: - View

struct InvoiceDetailView: View {
    let invoiceId: String
    @Environment(AuthViewModel.self) private var auth
    @State private var vm = InvoiceDetailViewModel()

    var body: some View {
        ZStack {
            if let invoice = vm.invoice {
                InvoiceDetailContent(invoice: invoice)
            } else if let msg = vm.errorMessage {
                EmptyStateView(icon: "exclamationmark.triangle", title: "Failed to Load", message: msg)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                Color.clear
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .overlay {
            if vm.isLoading {
                ProgressView()
            }
        }
        .navigationTitle(vm.invoice?.displayNumber ?? "Invoice")
        .refreshable { await reload() }
        .task { await reload() }
    }

    private func reload() async {
        guard let token = auth.token else { return }
        await vm.load(id: invoiceId, token: token)
    }
}

// MARK: - Content

private struct InvoiceDetailContent: View {
    let invoice: InvoiceDetail

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                headerCard
                datesCard
                if invoice.customer != nil || invoice.serviceAddress != nil {
                    addressCard
                }
                lineItemsCard
                sourceCard
            }
            .padding()
        }
    }

    // MARK: Header

    private var headerCard: some View {
        VStack(spacing: 12) {
            HStack {
                Text(invoice.displayNumber)
                    .font(.title2.weight(.bold))
                Spacer()
                BadgeView.invoice(invoice.status)
            }
            Divider()
            HStack(alignment: .firstTextBaseline) {
                Text(invoice.amountFormatted)
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                Text(invoice.currency ?? "USD")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    // MARK: Dates

    private var datesCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            cardHeader("Dates")
            Group {
                dateRow(label: "Issued", value: invoice.issuedAt.formattedDate, color: .primary)
                if let due = invoice.dueDate {
                    Divider().padding(.leading, 16)
                    dateRow(
                        label: "Due",
                        value: due.formattedDate,
                        color: invoice.isOverdue ? .red : .primary
                    )
                }
                if let paid = invoice.paidAt {
                    Divider().padding(.leading, 16)
                    dateRow(label: "Paid", value: paid.formattedDate, color: .green)
                }
            }
        }
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func dateRow(label: String, value: String, color: Color) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .fontWeight(.medium)
                .foregroundStyle(color)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: Address

    private var addressCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            cardHeader("Details")
            if let cust = invoice.customer {
                infoRow(label: "Customer",   value: cust.name)
                Divider().padding(.leading, 16)
                infoRow(label: "Account #",  value: "\(cust.accountNumber)")
                if !cust.address.isEmpty {
                    Divider().padding(.leading, 16)
                    infoRow(label: "Address", value: cust.fullAddress)
                }
                if !cust.phone.isEmpty {
                    Divider().padding(.leading, 16)
                    infoRow(label: "Phone",   value: cust.phone)
                }
                if !cust.email.isEmpty {
                    Divider().padding(.leading, 16)
                    infoRow(label: "Email",   value: cust.email)
                }
            }
            if let site = invoice.serviceAddress {
                if invoice.customer != nil { Divider().padding(.leading, 16) }
                infoRow(
                    label: site.label ?? "Service Address",
                    value: site.fullAddress
                )
            }
        }
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func infoRow(label: String, value: String) -> some View {
        HStack(alignment: .top) {
            Text(label)
                .foregroundStyle(.secondary)
                .frame(width: 110, alignment: .leading)
            Text(value)
                .fontWeight(.medium)
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: Line Items

    private var lineItemsCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            cardHeader("Line Items")
            if invoice.lineItems.isEmpty {
                Text("No line items")
                    .foregroundStyle(.secondary)
                    .padding()
            } else {
                ForEach(Array(invoice.lineItems.enumerated()), id: \.offset) { idx, item in
                    if idx > 0 { Divider().padding(.leading, 16) }
                    HStack(alignment: .top) {
                        Text(item.description)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(item.amountFormatted)
                            .fontWeight(.semibold)
                            .foregroundStyle(.primary)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }
                if invoice.lineItems.count > 1 {
                    Divider()
                    HStack {
                        Text("Total")
                            .fontWeight(.semibold)
                        Spacer()
                        Text(invoice.amountFormatted)
                            .fontWeight(.bold)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }
            }
        }
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    // MARK: Source

    private var sourceCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            cardHeader("Source")
            infoRow(label: "Type", value: invoice.sourceTypeLabel)
            if let created = invoice.createdAt {
                Divider().padding(.leading, 16)
                infoRow(label: "Created", value: created.formattedDate)
            }
        }
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    // MARK: Helpers

    private func cardHeader(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .tracking(1)
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 6)
    }
}

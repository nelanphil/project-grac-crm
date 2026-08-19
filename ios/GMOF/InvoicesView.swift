import SwiftUI

// MARK: - ViewModel

@Observable
@MainActor
class InvoicesViewModel {
    var invoices: [Invoice] = []
    var isLoading = false
    var errorMessage: String?

    func load(token: String, status: String?) async {
        isLoading = true
        errorMessage = nil
        do {
            invoices = try await APIClient.shared.invoices(
                token: token,
                status: status == "all" ? nil : status
            ).invoices
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        isLoading = false
    }
}

// MARK: - View

struct InvoicesView: View {
    @Environment(AuthViewModel.self) private var auth
    @State private var vm = InvoicesViewModel()
    @State private var selectedStatus = "all"

    private let statuses: [(label: String, value: String)] = [
        ("All",     "all"),
        ("Open",    "open"),
        ("Paid",    "paid"),
        ("Draft",   "draft"),
        ("Void",    "void"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            // Status filter chips
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(statuses, id: \.value) { option in
                        InvoiceFilterChip(
                            label: option.label,
                            isSelected: selectedStatus == option.value
                        ) {
                            selectedStatus = option.value
                            Task { await reload() }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
            Divider()

            List {
                ForEach(vm.invoices) { invoice in
                    NavigationLink(destination: InvoiceDetailView(invoiceId: invoice.id)) {
                        InvoiceRow(invoice: invoice)
                    }
                }

                if vm.invoices.isEmpty && !vm.isLoading {
                    EmptyStateView(
                        icon: "dollarsign.circle",
                        title: "No Invoices",
                        message: "No invoices match the selected filter."
                    )
                    .listRowSeparator(.hidden)
                }
            }
            .listStyle(.plain)
        }
        .navigationTitle("Invoices")
        .overlay { if vm.isLoading { ProgressView() } }
        .refreshable { await reload() }
        .task { await reload() }
        .alert("Error", isPresented: Binding(get: { vm.errorMessage != nil }, set: { _ in vm.errorMessage = nil })) {
            Button("OK", role: .cancel) {}
        } message: { Text(vm.errorMessage ?? "") }
    }

    private func reload() async {
        guard let token = auth.token else { return }
        await vm.load(token: token, status: selectedStatus)
    }
}

// MARK: - Row

private struct InvoiceRow: View {
    let invoice: Invoice

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(invoice.displayNumber)
                    .font(.headline)
                if let due = invoice.dueDate {
                    Text("Due: \(due.formattedDate)")
                        .font(.caption)
                        .foregroundStyle(invoice.isOverdue ? .red : .secondary)
                } else {
                    Text("Issued: \(invoice.issuedAt.formattedDate)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 6) {
                Text(invoice.amountFormatted)
                    .font(.subheadline.weight(.semibold))
                BadgeView.invoice(invoice.status)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Filter Chip

private struct InvoiceFilterChip: View {
    let label: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.caption.weight(.medium))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(isSelected ? Color.brandOrange : Color.secondary.opacity(0.15))
                .foregroundStyle(isSelected ? .white : .primary)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

import SwiftUI

// MARK: - ViewModel

@Observable
@MainActor
class HomeViewModel {
    var invoices: [Invoice] = []
    var isLoading = false
    var errorMessage: String?

    // KPIs computed from fetched invoices
    var openCount:    Int { invoices.filter { $0.status == "open" }.count }
    var overdueCount: Int { invoices.filter { $0.isOverdue }.count }
    var paidCount:    Int { invoices.filter { $0.status == "paid" }.count }
    var totalValue:   String {
        let cents = invoices.reduce(0) { $0 + $1.amountCents }
        return String(format: "$%.0f", Double(cents) / 100.0)
    }
    var recentPaid: [Invoice] {
        invoices.filter { $0.status == "paid" }
            .sorted { ($0.paidAt ?? "") > ($1.paidAt ?? "") }
            .prefix(4).map { $0 }
    }
    var recentOpen: [Invoice] {
        invoices.filter { $0.status == "open" }
            .prefix(4).map { $0 }
    }

    func load(token: String) async {
        isLoading = true
        errorMessage = nil
        do {
            invoices = try await APIClient.shared.invoices(token: token).invoices
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        isLoading = false
    }
}

// MARK: - View

struct HomeView: View {
    @Environment(AuthViewModel.self) private var auth
    @State private var vm = HomeViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                // KPI grid
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    KPICard(title: "Open Invoices", value: "\(vm.openCount)",    color: .brandOrange, icon: "doc.text")
                    KPICard(title: "Overdue",        value: "\(vm.overdueCount)", color: .red,         icon: "exclamationmark.circle")
                    KPICard(title: "Paid",           value: "\(vm.paidCount)",    color: .green,        icon: "checkmark.circle")
                    KPICard(title: "Total Value",    value: vm.totalValue,        color: .blue,         icon: "dollarsign.circle")
                }

                // Recent payments
                if !vm.recentPaid.isEmpty {
                    queueSection(title: "Recent Payments", items: vm.recentPaid)
                }

                // Open queue
                if !vm.recentOpen.isEmpty {
                    queueSection(title: "Open Invoices", items: vm.recentOpen)
                }

                if vm.invoices.isEmpty && !vm.isLoading {
                    EmptyStateView(icon: "tray", title: "No Invoices", message: "Invoice data will appear here.")
                }
            }
            .padding()
        }
        .navigationTitle("Dashboard")
        .overlay {
            if vm.isLoading && vm.invoices.isEmpty {
                ProgressView()
            }
        }
        .refreshable { await reload() }
        .task { await reload() }
        .alert("Error", isPresented: Binding(get: { vm.errorMessage != nil }, set: { _ in vm.errorMessage = nil })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(vm.errorMessage ?? "")
        }
    }

    @ViewBuilder
    private func queueSection(title: String, items: [Invoice]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
            VStack(spacing: 0) {
                ForEach(items) { invoice in
                    NavigationLink(destination: InvoiceDetailView(invoiceId: invoice.id)) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(invoice.displayNumber)
                                    .font(.subheadline.weight(.medium))
                                Text(invoice.issuedAt.formattedDate)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 4) {
                                Text(invoice.amountFormatted)
                                    .font(.subheadline.weight(.semibold))
                                BadgeView.invoice(invoice.status)
                            }
                        }
                        .padding(.vertical, 10)
                        .padding(.horizontal, 14)
                    }
                    .buttonStyle(.plain)
                    if invoice.id != items.last?.id {
                        Divider().padding(.leading, 14)
                    }
                }
            }
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }

    private func reload() async {
        guard let token = auth.token else { return }
        await vm.load(token: token)
    }
}

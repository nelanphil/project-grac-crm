import SwiftUI

// MARK: - ViewModel

@Observable
@MainActor
class CustomersViewModel {
    var customers: [CustomerListItem] = []
    var total = 0
    var currentPage = 1
    var isLoading = false
    var isLoadingMore = false
    var errorMessage: String?

    var hasMore: Bool { customers.count < total }

    func load(token: String, search: String) async {
        isLoading = true
        errorMessage = nil
        currentPage = 1
        do {
            let r = try await APIClient.shared.customers(token: token, page: 1, search: search)
            customers = r.customers
            total = r.total
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        isLoading = false
    }

    func loadMore(token: String, search: String) async {
        guard hasMore, !isLoadingMore else { return }
        isLoadingMore = true
        currentPage += 1
        do {
            let r = try await APIClient.shared.customers(token: token, page: currentPage, search: search)
            customers.append(contentsOf: r.customers)
        } catch {
            currentPage -= 1
        }
        isLoadingMore = false
    }
}

// MARK: - View

struct CustomersView: View {
    @Environment(AuthViewModel.self) private var auth
    @State private var vm = CustomersViewModel()
    @State private var searchText = ""

    var body: some View {
        customerList
            .navigationTitle("Customers")
            .searchable(text: $searchText, prompt: "Search by name, phone, city")
            .overlay { if vm.isLoading { ProgressView() } }
            .refreshable { await reload() }
            .task { await reload() }
            .onChange(of: searchText) { _, _ in
                Task {
                    try? await Task.sleep(for: .milliseconds(350))
                    await reload()
                }
            }
            .alert("Error", isPresented: Binding(get: { vm.errorMessage != nil }, set: { _ in vm.errorMessage = nil })) {
                Button("OK", role: .cancel) {}
            } message: { Text(vm.errorMessage ?? "") }
    }

    @ViewBuilder
    private var customerList: some View {
        List {
            ForEach(vm.customers) { customer in
                NavigationLink(destination: CustomerDetailPlaceholder(customer: customer)) {
                    CustomerRow(customer: customer)
                }
            }
            if vm.hasMore { loadMoreRow }
            if vm.customers.isEmpty && !vm.isLoading { emptyState }
        }
        .listStyle(.plain)
    }

    @ViewBuilder
    private var loadMoreRow: some View {
        HStack {
            Spacer()
            if vm.isLoadingMore {
                ProgressView()
            } else {
                Button("Load More") {
                    Task { await vm.loadMore(token: auth.token ?? "", search: searchText) }
                }
                .foregroundStyle(Color.brandOrange)
            }
            Spacer()
        }
    }

    private var emptyState: some View {
        let msg = searchText.isEmpty ? "No customers found." : "No results for \"\(searchText)\"."
        return EmptyStateView(icon: "person.2", title: "No Customers", message: msg)
            .listRowSeparator(.hidden)
    }

    private func reload() async {
        guard let token = auth.token else { return }
        await vm.load(token: token, search: searchText)
    }
}

// MARK: - Row

private struct CustomerRow: View {
    let customer: CustomerListItem

    private var activeCount:  Int { customer.contracts.filter { $0.standing == "active"   }.count }
    private var dueSoonCount: Int { customer.contracts.filter { $0.standing == "due_soon" }.count }
    private var expiredCount: Int { customer.contracts.filter { $0.standing == "expired"  }.count }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(customer.displayName)
                    .font(.headline)
                Spacer()
                if customer.duplicateCount ?? 0 > 0 {
                    BadgeView(text: "Duplicate", color: .orange)
                }
            }

            if let loc = customer.locationText {
                Text(loc)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if let phone = customer.phone, !phone.isEmpty {
                Text(phone)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if !customer.contracts.isEmpty {
                HStack(spacing: 6) {
                    if activeCount  > 0 { BadgeView(text: "\(activeCount) Active",   color: .green) }
                    if dueSoonCount > 0 { BadgeView(text: "\(dueSoonCount) Due Soon", color: .brandOrange) }
                    if expiredCount > 0 { BadgeView(text: "\(expiredCount) Expired",  color: .red) }
                }
                .padding(.top, 2)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Detail Placeholder

private struct CustomerDetailPlaceholder: View {
    let customer: CustomerListItem
    var body: some View {
        EmptyStateView(icon: "person.fill", title: customer.displayName, message: "Full detail view coming soon.")
            .navigationTitle(customer.displayName)
    }
}

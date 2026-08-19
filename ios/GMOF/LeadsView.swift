import SwiftUI

// MARK: - ViewModel

@Observable
@MainActor
class LeadsViewModel {
    var leads: [Lead] = []
    var total = 0
    var currentPage = 1
    var isLoading = false
    var isLoadingMore = false
    var errorMessage: String?

    var hasMore: Bool { leads.count < total }

    func load(token: String, search: String, status: String?) async {
        isLoading = true
        errorMessage = nil
        currentPage = 1
        do {
            let r = try await APIClient.shared.leads(
                token: token, page: 1, search: search,
                status: status == "all" ? nil : status
            )
            leads = r.leads
            total = r.total
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        isLoading = false
    }

    func loadMore(token: String, search: String, status: String?) async {
        guard hasMore, !isLoadingMore else { return }
        isLoadingMore = true
        currentPage += 1
        do {
            let r = try await APIClient.shared.leads(
                token: token, page: currentPage, search: search,
                status: status == "all" ? nil : status
            )
            leads.append(contentsOf: r.leads)
        } catch {
            currentPage -= 1
        }
        isLoadingMore = false
    }
}

// MARK: - Status options

private struct LeadStatusOption: Identifiable {
    var id: String { value }
    let label: String
    let value: String
}

private let leadStatuses: [LeadStatusOption] = [
    LeadStatusOption(label: "All",       value: "all"),
    LeadStatusOption(label: "New",       value: "new"),
    LeadStatusOption(label: "Contacted", value: "contacted"),
    LeadStatusOption(label: "Qualified", value: "qualified"),
    LeadStatusOption(label: "Proposal",  value: "proposal"),
    LeadStatusOption(label: "Won",       value: "won"),
    LeadStatusOption(label: "Lost",      value: "lost"),
]

// MARK: - View

struct LeadsView: View {
    @Environment(AuthViewModel.self) private var auth
    @State private var vm = LeadsViewModel()
    @State private var searchText = ""
    @State private var selectedStatus = "all"

    var body: some View {
        VStack(spacing: 0) {
            filterBar
            Divider()
            leadsList
        }
        .navigationTitle("Leads")
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

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(leadStatuses) { option in
                    StatusChip(label: option.label, isSelected: selectedStatus == option.value) {
                        selectedStatus = option.value
                        Task { await reload() }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
    }

    @ViewBuilder
    private var leadsList: some View {
        List {
            ForEach(vm.leads) { lead in LeadRow(lead: lead) }
            if vm.hasMore {
                loadMoreRow
            }
            if vm.leads.isEmpty && !vm.isLoading {
                EmptyStateView(
                    icon: "star",
                    title: "No Leads",
                    message: searchText.isEmpty ? "No leads found." : "No results for \"\(searchText)\"."
                )
                .listRowSeparator(.hidden)
            }
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
                    Task { await vm.loadMore(token: auth.token ?? "", search: searchText, status: selectedStatus) }
                }
                .foregroundStyle(Color.brandOrange)
            }
            Spacer()
        }
    }

    private func reload() async {
        guard let token = auth.token else { return }
        await vm.load(token: token, search: searchText, status: selectedStatus)
    }
}

// MARK: - Row

private struct LeadRow: View {
    let lead: Lead

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(lead.displayName)
                    .font(.headline)
                Spacer()
                BadgeView.lead(lead.status)
            }
            if let loc = lead.locationText {
                Text(loc).font(.subheadline).foregroundStyle(.secondary)
            }
            if let phone = lead.phone, !phone.isEmpty {
                Text(phone).font(.caption).foregroundStyle(.secondary)
            }
            Text(lead.createdAt.formattedDate)
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Status Chip

private struct StatusChip: View {
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

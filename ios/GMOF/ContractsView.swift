import SwiftUI

// MARK: - ViewModel

@Observable
@MainActor
class ContractsViewModel {
    var contracts: [Contract] = []
    var isLoading = false
    var errorMessage: String?

    func load(token: String, standing: String) async {
        isLoading = true
        errorMessage = nil
        do {
            contracts = try await APIClient.shared.contracts(token: token, standing: standing).contracts
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        isLoading = false
    }
}

// MARK: - View

struct ContractsView: View {
    @Environment(AuthViewModel.self) private var auth
    @State private var vm = ContractsViewModel()
    @State private var selectedStanding = "all"

    private let standings: [(label: String, value: String)] = [
        ("All",       "all"),
        ("Active",    "active"),
        ("Due Soon",  "due_soon"),
        ("Expired",   "expired"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            // Filter chips
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(standings, id: \.value) { option in
                        StandingChip(
                            label: option.label,
                            isSelected: selectedStanding == option.value
                        ) {
                            selectedStanding = option.value
                            Task { await reload() }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
            Divider()

            List {
                ForEach(vm.contracts) { contract in
                    ContractRow(contract: contract)
                }

                if vm.contracts.isEmpty && !vm.isLoading {
                    EmptyStateView(
                        icon: "doc.text",
                        title: "No Contracts",
                        message: "No contracts match the selected filter."
                    )
                    .listRowSeparator(.hidden)
                }
            }
            .listStyle(.plain)
        }
        .navigationTitle("Contracts")
        .overlay { if vm.isLoading { ProgressView() } }
        .refreshable { await reload() }
        .task { await reload() }
        .alert("Error", isPresented: Binding(get: { vm.errorMessage != nil }, set: { _ in vm.errorMessage = nil })) {
            Button("OK", role: .cancel) {}
        } message: { Text(vm.errorMessage ?? "") }
    }

    private func reload() async {
        guard let token = auth.token else { return }
        await vm.load(token: token, standing: selectedStanding)
    }
}

// MARK: - Row

private struct ContractRow: View {
    let contract: Contract

    private var title: String {
        contract.template?.label ?? contract.description
    }
    private var customerName: String {
        contract.customer?.displayName ?? "—"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(customerName)
                    .font(.headline)
                Spacer()
                BadgeView.standing(contract.standing)
            }
            Text(title)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if let renewal = contract.renewalDueDate {
                Text("Renewal: \(renewal.formattedDate)")
                    .font(.caption)
                    .foregroundStyle(contract.standing == "expired" ? .red : .secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Standing Chip

private struct StandingChip: View {
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

// ======= IMPORTS =======
import IcpLedger "canister:icp_ledger_canister";
import Result "mo:base/Result";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Bool "mo:base/Bool";
import Nat "mo:base/Nat";
import Map "mo:map/Map";
import Vector "mo:vector";
import { phash; n64hash } "mo:map/Map";
import Nat64 "mo:base/Nat64";
import Buffer "mo:base/Buffer";
import Array "mo:base/Array";
import Debug "mo:base/Debug";
import Float "mo:base/Float";
import Types "./Types";
import Utils "./Utils";

actor IcpTransfer_backend {

    // ======= STATE VARIABLES =======
    stable var users = Map.new<Principal, Types.User>();
    stable var proposals : Types.Vector<Types.Proposal> = Vector.new<Types.Proposal>();
    stable var proposal_images = Map.new<Nat64, Blob>();
    stable var proposal_files = Map.new<Nat64, Types.Vector<Types.File>>();

    stable var proposal_fee : Nat64 = 1 * (10 ** 8); // 1 ICP in e8s
    stable var fee_sink : Principal = Principal.fromText("gyvkh-qm3gw-myzkz-awlbs-g2yok-3qiuv-i44w2-mmzjj-jkd2r-wuikv-sae");

    // ======= USER MANAGEMENT FUNCTIONS =======

    // Get or create a user based on caller principal
    private func _getOrCreateUser(caller : Principal) : async Types.User {
        let user = Map.get<Principal, Types.User>(users, phash, caller);
        switch (user) {
            case (null) {
                let principal_as_subaccount = Utils.principalAsThirtyTwoBytes(caller);
                let latest_block_height = await getLatestBlockHeight();
                let newUser : Types.User = {
                    created_proposals = [];
                    locked_balance = 0;
                    principal = caller;
                    subaccount = principal_as_subaccount;
                    accountId = Utils.getAccountId(Principal.fromActor(IcpTransfer_backend), ?principal_as_subaccount);
                    created_at = latest_block_height;
                };
                Map.set<Principal, Types.User>(users, phash, caller, newUser);
                return newUser;
            };
            case (?user) {
                return user;
            };
        };
    };

    // Public endpoint to get or create a user
    public shared ({ caller }) func getOrCreateUser() : async Types.User {
        if (Principal.isAnonymous(caller)) {
            Debug.trap("Anonymous User");
        };
        await _getOrCreateUser(caller);
    };

    // Query a user by principal
    public shared query ({ caller }) func getUser() : async Result.Result<Types.User, Text> {
        if (Principal.isAnonymous(caller)) {
            Debug.trap("Anonymous User");
        };
        let user = Map.get<Principal, Types.User>(users, phash, caller);
        switch (user) {
            case (null) {
                return #err("User not found");
            };
            case (?user) {
                return #ok(user);
            };
        };
    };

    // Withdraw funds from user account
    public shared ({ caller }) func withdrawFromUserAccount(amount : Nat, to : Principal, subaccount : ?Blob) : async Result.Result<Bool, Text> {
        if (Principal.isAnonymous(caller)) {
            Debug.trap("Anonymous User");
        };
        let user = Map.get<Principal, Types.User>(users, phash, caller);
        switch (user) {
            case (null) {
                return #err("User not found");
            };
            case (?user) {
                let balance = await IcpLedger.account_balance_dfx({
                    account = user.accountId;
                });
                if (balance.e8s - user.locked_balance < Nat64.fromNat(amount) + 10_000) {
                    return #err("Insufficient balance");
                };
                let transferResult = await IcpLedger.icrc1_transfer({
                    to = {
                        owner = to;
                        subaccount = subaccount;
                    };
                    fee = null;
                    memo = ?Text.encodeUtf8("op:withdraw");
                    from_subaccount = ?user.subaccount;
                    created_at_time = null;
                    amount = amount;
                });
                switch (transferResult) {
                    case (#Err(_)) {
                        return #err("Transfer failed");
                    };
                    case (#Ok(_)) {
                        return #ok(true);
                    };
                };
            };
        };
    };

    public func withdraw_from_user_account(amount : Nat, user_principal : Principal, to : Principal, to_subaccount : ?Blob) : async Result.Result<Bool, Text> {
        let user = Map.get<Principal, Types.User>(users, phash, user_principal);
        switch (user) {
            case (null) {
                return #err("User not found");
            };
            case (?user) {

                let transferResult = await IcpLedger.icrc1_transfer({
                    to = {
                        owner = to;
                        subaccount = to_subaccount;
                    };
                    fee = null;
                    memo = ?Text.encodeUtf8("op:withdraw");
                    from_subaccount = ?user.subaccount;
                    created_at_time = null;
                    amount = amount;
                });
                switch (transferResult) {
                    case (#Err(_)) {
                        return #err("Transfer failed");
                    };
                    case (#Ok(_)) {
                        return #ok(true);
                    };
                };
            };
        };

    };

    public func withdraw_from_proposal_account(amount : Nat, proposal_id : Nat64, to : Principal, to_subaccount : ?Blob) : async Result.Result<Bool, Text> {
        let proposal = Vector.getOpt<Types.Proposal>(proposals, Nat64.toNat(proposal_id));
        switch (proposal) {
            case (null) {
                return #err("Proposal not found");
            };
            case (?proposal) {
                let transferResult = await IcpLedger.icrc1_transfer({
                    to = {
                        owner = to;
                        subaccount = to_subaccount;
                    };
                    fee = null;
                    memo = ?Text.encodeUtf8("op:withdraw");
                    from_subaccount = ?proposal.subaccount;
                    created_at_time = null;
                    amount = amount;
                });
                switch (transferResult) {
                    case (#Err(_)) {
                        return #err("Transfer failed");
                    };
                    case (#Ok(_)) {
                        return #ok(true);
                    };
                };
            };
        };
    };
    // ======= PROPOSAL MANAGEMENT FUNCTIONS =======

    // Create a new proposal
    public shared ({ caller }) func createProposal(name : Text, title : Text, description : Text, amount_required : Nat64, image : Blob) : async Result.Result<Nat, Text> {
        if (Principal.isAnonymous(caller)) {
            Debug.trap("Anonymous User");
        };
        var proposal_size = Vector.size<Types.Proposal>(proposals);
        var proposal_subaccount = Utils.natAsSubaccount(proposal_size);
        var user = await _getOrCreateUser(caller);
        var balance = await IcpLedger.account_balance_dfx({
            account = user.accountId;
        });
        if (balance.e8s - user.locked_balance < proposal_fee) {
            return #err("Insufficient balance");
        };
        if (Float.fromInt(Nat64.toNat(amount_required)) < 0.5 * (10 ** 8)) {
            return #err("Amount required must be greater than 0.5 ICP");
        };
        // increase locked balance
        var new_locked_balance = user.locked_balance + proposal_fee;
        // create proposal
        let latest_block_height = await getLatestBlockHeight();
        var newProposal : Types.Proposal = {
            index = Nat64.fromNat(proposal_size);
            name = name;
            title = title;
            description = description;
            subaccount = proposal_subaccount;
            accountId = Utils.getAccountId(Principal.fromActor(IcpTransfer_backend), ?proposal_subaccount);
            created_by = caller;
            amount_required = amount_required;
            claimed = false;
            created_at = latest_block_height;
        };
        Map.set<Nat64, Blob>(proposal_images, n64hash, Nat64.fromNat(proposal_size), image);
        Vector.add<Types.Proposal>(proposals, newProposal);
        var new_user = await addCreatedProposalToUsers(user, Nat64.fromNat(proposal_size));
        var new_user2 = await setLockedBalance(new_user, new_locked_balance);
        Map.set<Principal, Types.User>(users, phash, caller, new_user2);
        return #ok(proposal_size);
    };

    public shared ({ caller }) func donateToProposal(proposalId : Nat, amount : Nat64) : async Result.Result<Bool, Text> {
        if (Principal.isAnonymous(caller)) {
            Debug.trap("Anonymous User");
        };
        let user = Map.get<Principal, Types.User>(users, phash, caller);
        switch (user) {
            case (null) {
                return #err("User not found");
            };
            case (?user) {
                var balance = await IcpLedger.account_balance_dfx({
                    account = user.accountId;
                });
                if (balance.e8s - user.locked_balance < amount + 10_000) {
                    return #err("Insufficient balance");
                };
                var proposal = Vector.getOpt<Types.Proposal>(proposals, proposalId);
                switch (proposal) {
                    case (null) {
                        return #err("No Proposal is available with this id");
                    };
                    case (?proposal) {
                        var amount_raised = await IcpLedger.account_balance_dfx({
                            account = proposal.accountId;
                        });
                        if (amount_raised.e8s >= proposal.amount_required) {
                            return #err("Proposal has already reached the required amount");
                        };
                        let transferResult = await IcpLedger.icrc1_transfer({
                            to = {
                                owner = Principal.fromActor(IcpTransfer_backend);
                                subaccount = ?proposal.subaccount;
                            };
                            fee = null;
                            memo = ?Text.encodeUtf8("op:donate");
                            from_subaccount = ?user.subaccount;
                            created_at_time = null;
                            amount = Nat64.toNat(amount);
                        });
                        switch (transferResult) {
                            case (#Err(_)) {
                                return #err("Transfer failed");
                            };
                            case (#Ok(_)) {
                                return #ok(true);
                            };
                        };
                    };
                };

            };
        };
    };

    // Claim funds from a successful proposal
    public shared ({ caller }) func claimProposal(proposalId : Nat) : async Result.Result<Bool, Text> {
        if (Principal.isAnonymous(caller)) {
            Debug.trap("Anonymous User");
        };
        var size = Vector.size<Types.Proposal>(proposals);
        if (proposalId >= size) {
            return #err("No Proposal is available with this id");
        } else {
            var proposal = Vector.getOpt<Types.Proposal>(proposals, proposalId);
            switch (proposal) {
                case (null) {
                    return #err("No Proposal is available with this id");
                };
                case (?proposal) {
                    if (proposal.created_by == caller) {
                        var amount_raised = await IcpLedger.account_balance_dfx({
                            account = proposal.accountId;
                        });
                        if (amount_raised.e8s >= proposal.amount_required) {
                            if (not proposal.claimed) {
                                var user = await _getOrCreateUser(caller);
                                var fee_amount = amount_raised.e8s * 2 / 100;
                                var claimable_amount = amount_raised.e8s - fee_amount;
                                let transferResult = await IcpLedger.icrc1_transfer({
                                    to = {
                                        owner = Principal.fromActor(IcpTransfer_backend);
                                        subaccount = ?user.subaccount;
                                    };
                                    fee = null;
                                    memo = ?Text.encodeUtf8("op:claim");
                                    from_subaccount = ?proposal.subaccount;
                                    created_at_time = null;
                                    amount = Nat64.toNat(claimable_amount - 10_000);
                                });

                                switch (transferResult) {
                                    case (#Err(_)) {
                                        return #err("Claimable Amount Transfer failed");
                                    };
                                    case (#Ok(_)) {
                                        let feeTransferResult = await IcpLedger.icrc1_transfer({
                                            to = {
                                                owner = fee_sink;
                                                subaccount = null;
                                            };
                                            fee = null;
                                            memo = ?Text.encodeUtf8("op:fee");
                                            from_subaccount = ?proposal.subaccount;
                                            created_at_time = null;
                                            amount = Nat64.toNat(fee_amount - 10_000);
                                        });
                                        switch (feeTransferResult) {
                                            case (#Err(_)) {
                                                return #err("Fee Transfer failed");
                                            };
                                            case (#Ok(_)) {
                                                var new_user = await setLockedBalance(user, user.locked_balance - proposal_fee);
                                                var new_proposal = setClaimed(proposal);
                                                Vector.put<Types.Proposal>(proposals, proposalId, new_proposal);
                                                Map.set<Principal, Types.User>(users, phash, caller, new_user);
                                                return #ok(true);
                                            };
                                        };
                                    };
                                };

                            } else {
                                return #err("Already Funds are Claimed");
                            };
                        } else {
                            return #err("Cannot Claim Without raising required amount");
                        };
                    } else {
                        return #err("Only Proposal Creator Can Call this Method");
                    };

                };
            };
        };
    };

    // Get a single proposal by ID
    public query func getProposal(id : Nat) : async Result.Result<Types.Proposal, Text> {
        var size = Vector.size<Types.Proposal>(proposals);
        if (id >= size) {
            return #err("No Proposal is available with this id");
        } else {
            var proposal = Vector.getOpt<Types.Proposal>(proposals, id);
            switch (proposal) {
                case (null) {
                    return #err("No Proposal is available with this id");
                };
                case (?proposal) {
                    return #ok(proposal);
                };
            };
        };
    };

    // Get latest proposals with limit
    public query func getLatestProposals(start : Nat, len : Nat) : async Result.Result<[Types.Proposal], Text> {
        var size = Vector.size<Types.Proposal>(proposals);
        if (size > 0) { 
            var arr = Vector.toArray<Types.Proposal>(proposals);
            if (size >= start + len) {
                var res = Array.subArray<Types.Proposal>(arr, start, len);
                return #ok(res);
            } else {
                return #ok(arr);
            };
        } else {
            return #ok([]);
        };
    };

    // Get latest proposals created by caller
    public shared query ({ caller }) func getLatestMyProposals(start : Nat, len : Nat) : async Result.Result<[Types.Proposal], Text> {
        if (Principal.isAnonymous(caller)) {
            Debug.trap("Anonymous User");
        };
        var size = Vector.size<Types.Proposal>(proposals);
        if (size > 0) {
            var arr = Vector.toArray<Types.Proposal>(proposals);
            var r_len = 0;
            switch (Map.get<Principal, Types.User>(users, phash, caller)) {
                case (null) {
                    return #ok([]);
                };
                case (?user) {
                    var props = Buffer.Buffer<Types.Proposal>(3);
                    var created_proposals = user.created_proposals;
                    var start_index = 0;
                    for (pid in created_proposals.vals()) {
                        if (start_index >= start) {
                            if (r_len < len) {
                                r_len := r_len + 1;
                                props.add(arr[Nat64.toNat(pid)]);
                            };
                        } else {
                            start_index := start_index + 1;
                        };
                    };
                    return #ok(Buffer.toArray<Types.Proposal>(props));
                };
            };
        } else {
            return #ok([]);
        };
    };

    // Get total number of proposals
    public query func getProposalsLength() : async Nat {
        var size = Vector.size<Types.Proposal>(proposals);
        return size;
    };

    // Get total number of proposals created by caller
    public shared query ({ caller }) func getMyProposalsLength() : async Nat {
        switch (Map.get<Principal, Types.User>(users, phash, caller)) {
            case (null) {
                return 0;
            };
            case (?user) {
                return user.created_proposals.size();
            };
        };
    };

    // Get proposal image by proposal id
    public query func getProposalImage(proposalId : Nat64) : async ?Blob {
        switch (Map.get<Nat64, Blob>(proposal_images, n64hash, proposalId)) {
            case (null) {
                return null;
            };
            case (?image) {
                return ?image;
            };
        };
    };

    // ======= FILE MANAGEMENT FUNCTIONS =======

    // Get or create a file vector for a proposal
    private func _getOrCreateProposalFiles(proposalId : Nat64) : Types.Vector<Types.File> {
        switch (Map.get<Nat64, Types.Vector<Types.File>>(proposal_files, n64hash, proposalId)) {
            case (null) {
                var new_files = Vector.new<Types.File>();
                Map.set<Nat64, Types.Vector<Types.File>>(proposal_files, n64hash, proposalId, new_files);
                return new_files;
            };
            case (?files) {
                return files;
            };
        };
    };

    // Get all files for a proposal
    public shared query func getProposalFiles(proposalId : Nat64) : async [Types.File] {
        switch (Map.get<Nat64, Types.Vector<Types.File>>(proposal_files, n64hash, proposalId)) {
            case (null) {
                return [];
            };
            case (?files) {
                return Vector.toArray<Types.File>(files);
            };
        };
    };

    // Get files metadata for a proposal
    public query func getProposalFilesList(proposalId : Nat64) : async [{
        name : Text;
        size : Nat;
        fileType : Text;
    }] {
        switch (Map.get<Nat64, Types.Vector<Types.File>>(proposal_files, n64hash, proposalId)) {
            case (null) {
                return [];
            };
            case (?files) {
                var file_list = Buffer.Buffer<{ name : Text; size : Nat; fileType : Text }>(3);
                for (file in Vector.vals<Types.File>(files)) {
                    file_list.add({
                        name = file.name;
                        size = file.totalSize;
                        fileType = file.fileType;
                    });
                };
                return Buffer.toArray<{ name : Text; size : Nat; fileType : Text }>(file_list);
            };
        };
    };

    // Get number of chunks for a file in a proposal
    public query func getProposalFileTotalChunks(proposalId : Nat64, name : Text) : async Nat {
        switch (Map.get<Nat64, Types.Vector<Types.File>>(proposal_files, n64hash, proposalId)) {
            case (null) {
                return 0;
            };
            case (?files) {
                for (file in Vector.vals<Types.File>(files)) {
                    if (file.name == name) {
                        return file.chunks.size();
                    };
                };
                return 0;
            };
        };
    };

    // Get a specific chunk of a file in a proposal
    public query func getProposalFileChunk(proposalId : Nat64, name : Text, index : Nat) : async ?Types.FileChunk {
        switch (Map.get<Nat64, Types.Vector<Types.File>>(proposal_files, n64hash, proposalId)) {
            case (null) {
                return null;
            };
            case (?files) {
                for (file in Vector.vals<Types.File>(files)) {
                    if (file.name == name) {
                        for (chunk in file.chunks.vals()) {
                            if (chunk.index == index) {
                                return ?chunk;
                            };
                        };
                    };
                };
                return null;
            };
        };
    };

    // Get file type for a file in a proposal
    public query func getProposalFileType(proposalId : Nat64, name : Text) : async ?Text {
        switch (Map.get<Nat64, Types.Vector<Types.File>>(proposal_files, n64hash, proposalId)) {
            case (null) {
                return null;
            };
            case (?files) {
                for (file in Vector.vals<Types.File>(files)) {
                    if (file.name == name) {
                        return ?file.fileType;
                    };
                };
                return null;
            };
        };
    };

    // Upload a file chunk to a proposal
    public shared ({ caller }) func uploadFileChunk(proposalId : Nat64, name : Text, chunk : Blob, index : Nat, fileType : Text) : async Result.Result<Bool, Text> {
        if (Principal.isAnonymous(caller)) {
            Debug.trap("Anonymous User");
        };
        var proposal = Vector.getOpt<Types.Proposal>(proposals, Nat64.toNat(proposalId));
        switch (proposal) {
            case (null) {
                return #err("No Proposal is available with this id");
            };
            case (?proposal) {
                if (caller != proposal.created_by) {
                    return #err("Only Proposal Creator Can Call this Method");
                };
                var fileChunk : Types.FileChunk = {
                    chunk = chunk;
                    index = index;
                };
                var files = _getOrCreateProposalFiles(proposalId);
                var found = false;
                var updated_files = Vector.new<Types.File>();
                for (file in Vector.vals<Types.File>(files)) {
                    if (file.name == name) {
                        found := true;
                        var updated_chunks = Array.append<Types.FileChunk>(file.chunks, [fileChunk]);
                        var updated_file : Types.File = {
                            name = name;
                            chunks = updated_chunks;
                            totalSize = file.totalSize + chunk.size();
                            fileType = fileType;
                        };
                        Vector.add<Types.File>(updated_files, updated_file);
                    } else {
                        Vector.add<Types.File>(updated_files, file);
                    };
                };
                if (not found) {
                    var new_file : Types.File = {
                        name = name;
                        chunks = [fileChunk];
                        totalSize = chunk.size();
                        fileType = fileType;
                    };
                    Vector.add<Types.File>(updated_files, new_file);
                };
                Map.set<Nat64, Types.Vector<Types.File>>(proposal_files, n64hash, proposalId, updated_files);
                return #ok(true);
            };
        };
    };

    // Delete a file from a proposal
    public shared ({ caller }) func deleteProposalFile(proposalId : Nat64, name : Text) : async Result.Result<Bool, Text> {
        if (Principal.isAnonymous(caller)) {
            Debug.trap("Anonymous User");
        };
        var proposal = Vector.getOpt<Types.Proposal>(proposals, Nat64.toNat(proposalId));
        switch (proposal) {
            case (null) {
                return #err("No Proposal is available with this id");
            };
            case (?proposal) {
                if (caller != proposal.created_by) {
                    return #err("Only Proposal Creator Can Call this Method");
                };
                switch (Map.get<Nat64, Types.Vector<Types.File>>(proposal_files, n64hash, proposalId)) {
                    case (null) {
                        return #err("No Files are available for this proposal");
                    };
                    case (?files) {
                        var updated_files = Vector.new<Types.File>();
                        var found = false;
                        for (file in Vector.vals<Types.File>(files)) {
                            if (file.name == name) {
                                found := true;
                            } else {
                                Vector.add<Types.File>(updated_files, file);
                            };
                        };
                        if (not found) {
                            return #err("No File is available with this name");
                        };
                        Map.set<Nat64, Types.Vector<Types.File>>(proposal_files, n64hash, proposalId, updated_files);
                        return #ok(true);
                    };
                };
            };
        };
    };

    // ======= UTILITY HELPER FUNCTIONS =======

    // Add a proposal to user's created proposals list
    private func addCreatedProposalToUsers(user : Types.User, proposalId : Nat64) : async Types.User {
        var new_created_proposals = Buffer.fromArray<Nat64>(user.created_proposals);
        switch (Buffer.indexOf<Nat64>(proposalId, new_created_proposals, Nat64.equal)) {
            case (null) {
                new_created_proposals.add(proposalId);
                var new_user : Types.User = {
                    created_proposals = Buffer.toArray(new_created_proposals);
                    locked_balance = user.locked_balance;
                    principal = user.principal;
                    subaccount = user.subaccount;
                    accountId = user.accountId;
                    created_at = user.created_at;
                };
                return new_user;
            };
            case (?_index) {
                return user;
            };
        };
    };

    // Update a user's locked balance
    private func setLockedBalance(user : Types.User, new_locked_balance : Nat64) : async Types.User {
        let new_user : Types.User = {
            principal = user.principal;
            subaccount = user.subaccount;
            accountId = user.accountId;
            created_proposals = user.created_proposals;
            locked_balance = new_locked_balance;
            created_at = user.created_at;
        };
        return new_user;
    };

    // Mark a proposal as claimed
    private func setClaimed(proposal : Types.Proposal) : Types.Proposal {
        let new_proposal : Types.Proposal = {
            index = proposal.index;
            name = proposal.name;
            title = proposal.title;
            description = proposal.description;
            subaccount = proposal.subaccount;
            accountId = proposal.accountId;
            created_by = proposal.created_by;
            claimed = true;
            amount_required = proposal.amount_required;
            created_at = proposal.created_at;
        };
        return new_proposal;
    };

    private func getLatestBlockHeight() : async Nat64 {
        let blockHeight = await IcpLedger.query_blocks({length = 1; start = 0});
        return blockHeight.chain_length -1;
    };

    // ======= SYSTEM UTILITIES =======

    // Get caller principal as text
    public shared query ({ caller }) func getCallerPrincipal() : async Text {
        return Principal.toText(caller);
    };

    // Get caller account ID
    public shared query ({ caller }) func getCallerAccountId() : async Text {
        return Utils.getAccountId(caller, null);
    };
};

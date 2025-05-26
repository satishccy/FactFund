module {
    // User data structure for managing account information
    public type User = {
        principal : Principal;
        subaccount : Blob;
        accountId : Text;
        created_proposals : [Nat64];
        locked_balance : Nat64;
        created_at : Nat64;
    };

    // Proposal data structure for fundraising campaigns
    public type Proposal = {
        index : Nat64;
        name : Text;
        title : Text;
        description : Text;
        subaccount : Blob;
        accountId : Text;
        created_by : Principal;
        amount_required : Nat64;
        claimed : Bool;
        created_at : Nat64;
    };

    // File storage related types
    public type FileChunk = {
        chunk : Blob;
        index : Nat;
    };

    public type File = {
        name : Text;
        chunks : [FileChunk];
        totalSize : Nat;
        fileType : Text;
    };

    // Vector data structure for efficient collection management
    public type Vector<Proposal> = {
        var data_blocks : [var [var ?Proposal]];
        var i_block : Nat;
        var i_element : Nat;
    };

    // Utilities for hash-based collections
    public type HashUtils<Principal> = (
        getHash : (Principal) -> Nat32,
        areEqual : (Principal, Principal) -> Bool,
    );
};

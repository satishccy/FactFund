"use client"

import { useState, useEffect } from "react"
import { Copy, ExternalLink, ArrowDown, ArrowUp } from 'lucide-react'
import { icp_index_canister } from '../../../declarations/icp_index_canister'
import { Principal } from "@dfinity/principal"

const Profile = ({ principal, accountId, actor, notify }) => {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [userData, setUserData] = useState(null)
  const [balance, setBalance] = useState({
    totalBalance: 0,
    lockedBalance: 0,
    availableBalance: 0,
  })
  const [transactions, setTransactions] = useState([])
  const [withdrawForm, setWithdrawForm] = useState({
    recipientPrincipal: '',
    amount: ''
  })
  const [isWithdrawing, setIsWithdrawing] = useState(false)

  // Fetch user data, balance, and transactions
  useEffect(() => {
    const fetchUserData = async () => {
      if (!actor || !principal) {
        setIsLoading(false);
        return;
      }

      const loadProfileData = async () => {
        setIsLoading(true);

        const user = await actor.getOrCreateUser();
        console.log("User data:", user);
        setUserData(user);

        // If we have the account ID, fetch balance and transactions
        if (user.accountId) {
          console.log("Fetching balance for account:", user.accountId);

          const balanceE8s = await icp_index_canister.get_account_identifier_balance(user.accountId);
          console.log("Balance in e8s:", balanceE8s.toString());

          const totalBalanceIcp = Number(balanceE8s) / 10 ** 8;

          const lockedBalanceIcp = Number(user.locked_balance) / 10 ** 8;

          const availableBalanceIcp = totalBalanceIcp - lockedBalanceIcp;

          setBalance({
            totalBalance: totalBalanceIcp,
            lockedBalance: lockedBalanceIcp,
            availableBalance: availableBalanceIcp,
          });

          // Fetch transactions
          console.log("Fetching transactions for account:", user.accountId);

          let allTxns = [];

          let txResult = await icp_index_canister.get_account_identifier_transactions({
            account_identifier: user.accountId,
            max_results: BigInt(100),
            start: [],
          });

          if (txResult && "Ok" in txResult) {
            allTxns.push(...txResult.Ok.transactions);
          }

          if (allTxns.length == 100) {
            while (true) {
              const lastTxnId = allTxns[allTxns.length - 1].id;
              if (lastTxnId > user.created_at) {
                txResult = await icp_index_canister.get_account_identifier_transactions({
                  account_identifier: user.accountId,
                  max_results: BigInt(100),
                  start: [lastTxnId],
                });
              } else {
                break;
              }
              if (txResult && "Ok" in txResult) {
                allTxns.push(...txResult.Ok.transactions);
                if (txResult.Ok.transactions.length < 100) {
                  break;
                }
              } else {
                break;
              }
            }
          }

          console.log("All transactions before filtering:", allTxns);

          allTxns = allTxns.filter((tx) => tx.id >= user.created_at);

          console.log("All transactions after filtering:", allTxns);


          const formattedTxs = allTxns.map((tx, index) => {
            try {
              const transaction = tx.transaction;
              let type = "unknown";
              let from = "";
              let to = "";
              let amount = 0;
              console.log("Transaction:", transaction, index);
              const icrc1_memo = transaction.icrc1_memo.length > 0 ? transaction.icrc1_memo[0] : new Uint8Array();
              const decoder = new TextDecoder();
              const memo = decoder.decode(icrc1_memo);
              console.log("Memo:", memo, index);
              // Determine transaction type and details based on operation
              if (transaction.operation && "Transfer" in transaction.operation) {
                const transfer = transaction.operation.Transfer;
                from = transfer.from || "Unknown";
                to = transfer.to || "Unknown";
                amount = transfer.amount && typeof transfer.amount.e8s !== 'undefined'
                  ? Number(transfer.amount.e8s) / 10 ** 8
                  : 0;

                // Determine if this is a deposit, withdraw, donate, or claim
                if (from === user.accountId) {
                  // If the user is sending funds
                  if (memo.includes("donate")) {
                    type = "donate";
                  } else {
                    type = "withdraw";
                  }
                } else if (to === user.accountId) {
                  // If the user is receiving funds
                  if (memo.includes("claim")) {
                    type = "claim";
                  } else {
                    type = "deposit";
                  }
                }
              } else if (transaction.operation && "Mint" in transaction.operation) {
                const mint = transaction.operation.Mint;
                to = mint.to || "Unknown";
                amount = mint.amount && typeof mint.amount.e8s !== 'undefined'
                  ? Number(mint.amount.e8s) / 10 ** 8
                  : 0;
                type = "deposit";
                from = "Minting Account";
              } else if (transaction.operation && "Burn" in transaction.operation) {
                const burn = transaction.operation.Burn;
                from = burn.from || "Unknown";
                amount = burn.amount && typeof burn.amount.e8s !== 'undefined'
                  ? Number(burn.amount.e8s) / 10 ** 8
                  : 0;
                type = "burn";
                to = "Burning Account";
              }

              let timestamp = new Date();
              if (transaction.timestamp && transaction.timestamp.length > 0 && typeof transaction.timestamp[0].timestamp_nanos !== 'undefined') {
                timestamp = new Date(Number(Number(transaction.timestamp[0].timestamp_nanos) / 1_000_000));
              }
              return {
                id: typeof tx.id !== 'undefined' ? Number(tx.id) : Math.random(),
                from,
                to,
                amount,
                type,
                timestamp,
              };
            } catch (err) {
              console.error("Error processing transaction:", err, tx);

              return {
                id: Math.random(),
                from: "Error",
                to: "Error",
                amount: 0,
                type: "unknown",
                timestamp: new Date(),
              };
            }
          });


          setTransactions(formattedTxs);

          return {
            availableBalance: availableBalanceIcp,
            transactionCount: formattedTxs.length
          };
        }

        throw new Error("No account ID found");
      };

      try {
        await notify.promise(
          loadProfileData(),
          {
            pending: 'Loading your profile data... 👤',
            success: (data) => `Profile loaded! Balance: ${data.availableBalance.toFixed(4)} ICP, ${data.transactionCount} transactions`,
            error: (error) => `Failed to load profile data: ${error.message}`
          }
        );
      } catch (err) {
        console.error("Error fetching user data:", err);
        setError("Failed to load profile data. Please try again later.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchUserData();
  }, [actor, principal, accountId, notify]);

  const copyToClipboard = (text) => {
    const copyText = async () => {
      await navigator.clipboard.writeText(text);
      return text;
    };

    notify.promise(
      copyText(),
      {
        pending: 'Copying to clipboard... 📋',
        success: '📋 Copied to clipboard!',
        error: 'Failed to copy to clipboard'
      }
    );
  };

  const formatDate = (date) => {
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getTransactionIcon = (type) => {
    switch (type) {
      case "donate":
        return <ArrowUp className="transaction-icon donate" />;
      case "claim":
        return <ArrowDown className="transaction-icon claim" />;
      case "deposit":
        return <ArrowDown className="transaction-icon deposit" />;
      case "withdraw":
        return <ArrowUp className="transaction-icon withdraw" />;
      default:
        return null;
    }
  };

  const getTransactionClass = (type) => {
    switch (type) {
      case "donate":
        return "donate";
      case "claim":
        return "claim";
      case "deposit":
        return "deposit";
      case "withdraw":
        return "withdraw";
      default:
        return "";
    }
  };

  const getTransactionType = (type) => {
    switch (type) {
      case "donate":
        return "Donate To Proposal";
      case "claim":
        return "Funds Claim from Proposal";
      case "deposit":
        return "Deposit";
      case "withdraw":
        return "Withdraw";
      case "burn":
        return "Burn";
      default:
        return type;
    }
  };

  const handleWithdraw = async () => {
    if (!actor) {
      notify.error("Please connect your wallet to withdraw funds");
      return;
    }

    if (!withdrawForm.recipientPrincipal.trim()) {
      notify.error("Please enter a recipient principal ID");
      return;
    }

    if (!withdrawForm.amount || parseFloat(withdrawForm.amount) <= 0) {
      notify.error("Please enter a valid withdrawal amount");
      return;
    }

    const withdrawAmount = parseFloat(withdrawForm.amount);
    if (withdrawAmount > balance.availableBalance) {
      notify.error(`Withdrawal amount cannot exceed available balance (${balance.availableBalance.toFixed(4)} ICP)`);
      return;
    }

    const withdrawProcess = async () => {
      setIsWithdrawing(true);

      try {
        // Convert amount to e8s (1 ICP = 10^8 e8s)
        const amountE8s = BigInt(Math.round(withdrawAmount * 10 ** 8));

        console.log("Withdrawing:", {
          recipient: withdrawForm.recipientPrincipal,
          amount: withdrawAmount,
          amountE8s: amountE8s.toString()
        });

        const recipientPrincipal = Principal.fromText(withdrawForm.recipientPrincipal);
        // Call the withdraw function from the backend
        const response = await actor.withdrawFromUserAccount(amountE8s, recipientPrincipal, []);

        console.log('Withdrawal response:', response);

        if ("ok" in response || "Ok" in response) {
          // Clear the form
          setWithdrawForm({
            recipientPrincipal: '',
            amount: ''
          });

          // Update balance immediately to reflect the withdrawal
          setBalance(prevBalance => ({
            ...prevBalance,
            totalBalance: prevBalance.totalBalance - withdrawAmount,
            availableBalance: prevBalance.availableBalance - withdrawAmount
          }));

          // Refresh the profile data after a delay to show the success toast
          setTimeout(() => {
            window.location.reload();
          }, 2000);

          return {
            amount: withdrawAmount,
            recipient: withdrawForm.recipientPrincipal
          };
        } else if ("err" in response) {
          throw new Error(response.err);
        } else if ("Err" in response) {
          throw new Error(response.Err);
        } else {
          throw new Error("Unexpected response from server");
        }
      } catch (error) {
        console.error("Withdrawal error:", error);
        throw error;
      } finally {
        setIsWithdrawing(false);
      }
    };

    try {
      await notify.promise(
        withdrawProcess(),
        {
          pending: 'Processing withdrawal... 💸',
          success: (data) => `✅ Successfully withdrew ${data.amount} ICP to ${data.recipient.substring(0, 10)}...`,
          error: (error) => `❌ Withdrawal failed: ${error.message}`
        }
      );
    } catch (error) {
      console.error("Withdrawal process failed:", error);
    }
  };

  return (
    <div className="profile-container">
      <div className="profile-header">
        <h1>Your Profile</h1>
        <div className="account-info">
          <div className="account-id">
            <h2>Account ID</h2>
            <div className="id-container">
              <span className="id-text">{userData?.accountId || "Not connected"}</span>
              <button
                className="icon-button"
                onClick={() => copyToClipboard(userData?.accountId)}
                disabled={!userData?.accountId}
              >
                <Copy size={16} />
              </button>
              <a
                href={`https://dashboard.internetcomputer.org/account/${userData?.accountId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="icon-button"
                style={{ opacity: userData?.accountId ? 1 : 0.5 }}
              >
                <ExternalLink size={16} />
              </a>
            </div>
          </div>


        </div>
      </div>

      <div className="profile-content">
        {isLoading ? (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Loading profile data...</p>
          </div>
        ) : error ? (
          <div className="error-state">
            <p>{error}</p>
            <button className="retry-button" onClick={() => window.location.reload()}>
              Retry
            </button>
          </div>
        ) : !userData ? (
          <div className="not-connected-state">
            <p>Please connect your wallet to view your profile.</p>
          </div>
        ) : (
          <>
            <div className="balance-cards">
              <div className="balance-card total">
                <h3>Total Balance</h3>
                <div className="balance-amount">{balance.totalBalance.toFixed(2)} ICP</div>
                <p className="balance-description">Total ICP in your account</p>
              </div>
              <div className="balance-card locked">
                <h3>Locked Balance</h3>
                <div className="balance-amount">{balance.lockedBalance.toFixed(2)} ICP</div>
                <p className="balance-description">ICP locked for active proposals</p>
              </div>
              <div className="balance-card available">
                <h3>Available Balance</h3>
                <div className="balance-amount">{balance.availableBalance.toFixed(2)} ICP</div>
                <p className="balance-description">ICP available for use</p>
              </div>
            </div>

            <div className="withdraw-section">
              <h2>Withdraw Funds</h2>
              <p className="profile-section-description">Transfer ICP from your account to another principal</p>

              <div className="withdraw-form">
                <div className="form-group">
                  <label htmlFor="recipient-principal">Recipient Principal ID *</label>
                  <input
                    type="text"
                    id="recipient-principal"
                    value={withdrawForm.recipientPrincipal}
                    onChange={(e) => setWithdrawForm({ ...withdrawForm, recipientPrincipal: e.target.value })}
                    placeholder="Enter recipient's principal ID"
                    className="principal-input"
                  />
                  <small>Enter the principal ID of the recipient</small>
                </div>

                <div className="form-group">
                  <label htmlFor="withdraw-amount">Amount (ICP) *</label>
                  <input
                    type="number"
                    id="withdraw-amount"
                    step="0.0001"
                    min="0.0001"
                    max={balance.availableBalance}
                    value={withdrawForm.amount}
                    onChange={(e) => setWithdrawForm({ ...withdrawForm, amount: e.target.value })}
                    placeholder="0.0000"
                    className="amount-input"
                  />
                  <small>Available: {balance.availableBalance.toFixed(4)} ICP</small>
                </div>

                <button
                  className="withdraw-btn"
                  onClick={handleWithdraw}
                  disabled={isWithdrawing || !withdrawForm.recipientPrincipal.trim() || !withdrawForm.amount || parseFloat(withdrawForm.amount) <= 0 || parseFloat(withdrawForm.amount) > balance.availableBalance}
                >
                  {isWithdrawing ? 'Processing Withdrawal...' : 'Withdraw Funds'}
                </button>

                {parseFloat(withdrawForm.amount) > balance.availableBalance && withdrawForm.amount && (
                  <div className="error-message">
                    Withdrawal amount cannot exceed available balance ({balance.availableBalance.toFixed(4)} ICP)
                  </div>
                )}
              </div>
            </div>
            {/*
            {userData.created_proposals && userData.created_proposals.length > 0 && (
              <div className="proposals-section">
                <h2>My Proposals</h2>
                <p className="profile-section-description">You have created {userData.created_proposals.length} proposals</p>
                <div className="proposals-list">
                  {userData.created_proposals.map((proposalId, index) => (
                    <div key={index} className="proposal-item">
                      <span>Proposal #{proposalId.toString()}</span>
                      <a href={`/proposals/${proposalId}`} className="view-proposal-link">
                        View Details
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
*/}
            <div className="transactions-section">
              <h2>Transaction History</h2>
              <p className="profile-section-description">Recent transactions for your account</p>

              <div className="transactions-container">
                <div className="transactions-header">
                  <div className="transaction-cell">From</div>
                  <div className="transaction-cell">To</div>
                  <div className="transaction-cell">Amount</div>
                  <div className="transaction-cell">Type</div>
                  <div className="transaction-cell">Date</div>
                </div>

                {transactions.length > 0 ? (
                  <div className="transactions-body">
                    {transactions.map((transaction) => (
                      <div
                        key={transaction.id}
                        className="transaction-row clickable"
                        onClick={() => window.open(`https://dashboard.internetcomputer.org/transaction/${transaction.id}`, '_blank')}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="transaction-cell from" data-label="From:">
                          {transaction.from && transaction.from.length > 10
                            ? `${transaction.from.substring(0, 10)}...`
                            : transaction.from}
                        </div>
                        <div className="transaction-cell to" data-label="To:">
                          {transaction.to && transaction.to.length > 10
                            ? `${transaction.to.substring(0, 10)}...`
                            : transaction.to}
                        </div>
                        <div className="transaction-cell amount" data-label="Amount:">
                          {transaction.amount.toFixed(2)} ICP
                        </div>
                        <div
                          className={`transaction-cell type ${getTransactionClass(transaction.type)}`}
                          data-label="Type:"
                        >
                          {getTransactionIcon(transaction.type)}
                          {getTransactionType(transaction.type)}
                        </div>
                        <div className="transaction-cell date" data-label="Date:">
                          {formatDate(transaction.timestamp)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="no-transactions">
                    <p>No transactions found.</p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Profile;
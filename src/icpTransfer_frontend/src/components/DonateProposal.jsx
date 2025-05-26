"use client"

import { useEffect, useState, useMemo } from "react"
import { useParams } from "react-router-dom"
import { Principal } from "@dfinity/principal"
import { ArrowDown, ArrowUp } from 'lucide-react'
import { icpTransfer_backend } from "../../../declarations/icpTransfer_backend"
import { icp_index_canister } from '../../../declarations/icp_index_canister'

const DonateProposal = ({ actor, notify, principal }) => {
  const { id } = useParams()
  const [proposal, setProposal] = useState(null)
  const [amount, setAmount] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isClaiming, setIsClaiming] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [proposalFiles, setProposalFiles] = useState([])
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)

  async function bufferToBase64(buffer) {
    // use a FileReader to generate a base64 data URI:
    const base64url = await new Promise((r) => {
      const reader = new FileReader()
      reader.onload = () => r(reader.result)
      reader.readAsDataURL(new Blob([buffer]))
    })
    // remove the `data:...;base64,` part from the start
    return base64url.slice(base64url.indexOf(",") + 1)
  }

  const fetchProposalFiles = async () => {
    if (!id) return

    try {
      setIsLoadingFiles(true)
      const filesList = await icpTransfer_backend.getProposalFilesList(Number(id))
      setProposalFiles(filesList)
      return filesList;
    } catch (error) {
      console.error("Error fetching files:", error)
      throw new Error("Failed to load proposal files");
    } finally {
      setIsLoadingFiles(false)
    }
  }

  const fetchProposal = async () => {
    if (!id) {
      notify.error("Invalid Proposal ID")
      setIsLoading(false)
      return
    }

    const loadProposal = async () => {
      setIsLoading(true)

      const res = await icpTransfer_backend.getProposal(Number(id))

      if (res.ok) {
        const val = res.ok
        const image = await icpTransfer_backend.getProposalImage(val.index);
        const b64 = "data:image/webp;base64," + (image.length > 0 ? await bufferToBase64(image[0]) : "");

        console.log("val", val)

        // Format proposal data with proper checks for amount_raised
        const amount_raised = Number(await icp_index_canister.get_account_identifier_balance(val.accountId)) / 10 ** 8

        let allTxns = [];
        let txResult = await icp_index_canister.get_account_identifier_transactions({
          account_identifier: val.accountId,
          max_results: BigInt(100),
          start: [],
        });

        if (txResult && "Ok" in txResult) {
          allTxns.push(...txResult.Ok.transactions);
        }

        if (allTxns.length == 100) {
          while (true) {
            const lastTxnId = allTxns[allTxns.length - 1].id;
            if (lastTxnId > val.created_at) {
              txResult = await icp_index_canister.get_account_identifier_transactions({
                account_identifier: val.accountId,
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


        allTxns = allTxns.filter((tx) => tx.id >= val.created_at);

        console.log("allTxns", allTxns)


        const formattedTxs = allTxns.map((tx, index) => {
          try {
            const transaction = tx.transaction;
            let type = "unknown";
            let accountId = "Unknown";
            let amount = 0;
            console.log("Transaction:", transaction, index);
            const icrc1_memo = transaction.icrc1_memo.length > 0 ? transaction.icrc1_memo[0] : new Uint8Array();
            const decoder = new TextDecoder();
            const memo = decoder.decode(icrc1_memo);
            console.log("Memo:", memo, index);
            // Determine transaction type and details based on operation
            if (transaction.operation && "Transfer" in transaction.operation) {
              const transfer = transaction.operation.Transfer;
              const from = transfer.from || "Unknown";
              const to = transfer.to || "Unknown";
              amount = transfer.amount && typeof transfer.amount.e8s !== 'undefined'
                ? Number(transfer.amount.e8s) / 10 ** 8
                : 0;

              // Determine if this is a deposit, withdraw, donate, or claim
              if (from === val.accountId) {
                // If the user is sending funds
                if (memo.includes("claim")) {
                  type = "claim";
                } else if (memo.includes("fee")) {
                  type = "fee";
                }
                accountId = to;
              } else if (to === val.accountId) {
                type = "donate";
                accountId = from;
              }
            }

            let timestamp = new Date();
            if (transaction.timestamp && transaction.timestamp.length > 0 && typeof transaction.timestamp[0].timestamp_nanos !== 'undefined') {
              timestamp = new Date(Number(Number(transaction.timestamp[0].timestamp_nanos) / 1_000_000));
            }
            return {
              id: typeof tx.id !== 'undefined' ? Number(tx.id) : Math.random(),
              accountId,
              amount,
              type,
              timestamp,
            };
          } catch (err) {
            console.error("Error processing transaction:", err, tx);

            return {
              id: Math.random(),
              accountId: "Error",
              amount: 0,
              type: "unknown",
              timestamp: new Date(),
            };
          }
        });


        console.log("formattedTxs", formattedTxs)

        const prop = {
          ...val,
          image: b64,
          created_by_text: Principal.from(val.created_by).toString(),
          amount_required: Number(val.amount_required) / 10 ** 8,
          amount_raised: amount_raised, // Add default of 0
          donations: formattedTxs || [], // Ensure donations exists
        }

        setProposal(prop)

        // Load files after proposal is loaded
        await fetchProposalFiles()

        return prop;
      } else {
        throw new Error(res.err || "Failed to fetch proposal");
      }
    };

    try {
      await notify.promise(
        loadProposal(),
        {
          pending: 'Loading proposal details... 📄',
          success: 'Proposal loaded successfully! ✅',
          error: (error) => `Error: ${error.message}`
        }
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchProposal()
  }, [id])

  const handleInputChange = (e) => {
    // Only allow numeric input with up to 8 decimal places
    const value = e.target.value
    if (/^\d*\.?\d{0,8}$/.test(value) || value === "") {
      setAmount(value)
    }
  }

  const getTransactionType = (type) => {
    switch (type) {
      case "claim":
        return "Funds Claim";
      case "fee":
        return "2% Platform Fee";
      case "donate":
        return "Donate To Proposal";
      default:
        return type;
    }
  };

  const getTransactionIcon = (type) => {
    switch (type) {
      case "donate":
        return <ArrowDown className="transaction-icon deposit" />;
      case "claim":
        return <ArrowUp className="transaction-icon claim" />;
      case "fee":
        return <ArrowUp className="transaction-icon withdraw" />;
      default:
        return null;
    }
  };

  const getTransactionClass = (type) => {
    switch (type) {
      case "donate":
        return "deposit";
      case "claim":
        return "claim";
      case "fee":
        return "withdraw";
      default:
        return "";
    }
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

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0])
      notify.info(`File selected: ${e.target.files[0].name}`)
    }
  }

  // Function to handle donation
  const handleDonateClick = async () => {
    if (!amount || Number.parseFloat(amount) <= 0) {
      notify.warning("Please enter a valid amount")
      return
    }

    if (!proposal) {
      notify.error("Proposal data not available")
      return
    }

    if (!actor) {
      notify.warning("Please login to continue")
      setIsLoading(false)
      return
    }

    const amountToFund = Number.parseFloat(amount)
    const remainingToFund = proposal.amount_required - proposal.amount_raised

    if (amountToFund > remainingToFund) {
      notify.warning(`Amount must not exceed ${remainingToFund.toFixed(8)} ICP`)
      return
    }

    console.log("amountToFund", amountToFund, "remainingToFund", remainingToFund)

    const processDonation = async () => {
      const params = {
        to: proposal.accountId,
        amount: Math.round(amountToFund * 10 ** 8),
        memo: "123451231231",
      }

      const result = await actor.donateToProposal(Number(id), amountToFund * 10 ** 8)

      console.log("result", result)

      if (result.ok) {
        setAmount("") // Clear the amount input

        return { amount: amountToFund };
      } else {
        throw new Error(result.err || "Unknown error");
      }
    };

    try {
      await notify.promise(
        processDonation(),
        {
          pending: 'Processing your donation... 💰',
          success: (data) => `🎉 Donation successful! You donated ${data.amount} ICP`,
          error: (error) => `Donation failed: ${error.message}`
        }
      );
    } catch (transferError) {
      console.error("Transfer error:", transferError)
    }
    finally {
      setTimeout(async () => {
        await fetchProposal()
      }, 3000)
    }
  }

  // Function to handle claiming funds
  const handleClaimClick = async () => {
    if (!actor) {
      notify.warning("Please login to continue")
      setIsLoading(false)
      return
    }

    const processClaim = async () => {
      setIsClaiming(true)

      const result = await actor.claimProposal(Number(id))

      if (result.ok) {
        // Update proposal to show claimed status
        setProposal((prev) => ({
          ...prev,
          claimed: true,
        }))

        return true;
      } else {
        throw new Error(result.err || "Failed to claim funds");
      }
    };

    try {
      await notify.promise(
        processClaim(),
        {
          pending: 'Processing claim request... ⏳',
          success: '🎉 Successfully claimed funds!',
          error: (error) => {
            return `Claim failed: ${error.message}`;
          }
        }
      );
    } catch (error) {
      console.error("Claim error:", error)
    } finally {
      setIsClaiming(false)
      setTimeout(async () => {
        await fetchProposal()
      }, 3000)
    }
  }

  // Function to handle file upload
  const handleFileUpload = async () => {
    if (!selectedFile || !actor) {
      notify.warning("Please select a file first")
      return
    }

    const uploadFile = async () => {
      setIsUploading(true)
      setUploadProgress(0)

      // Read file as chunks
      const fileType = selectedFile.type || "application/octet-stream"
      const chunkSize = 500 * 1024 // 500KB chunks
      const totalChunks = Math.ceil(selectedFile.size / chunkSize)

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * chunkSize
        const end = Math.min(start + chunkSize, selectedFile.size)
        const chunk = selectedFile.slice(start, end)

        // Convert chunk to array buffer
        const arrayBuffer = await chunk.arrayBuffer()
        const uint8Array = new Uint8Array(arrayBuffer)

        // Upload chunk
        const result = await actor.uploadFileChunk(Number(id), selectedFile.name, uint8Array, chunkIndex, fileType)

        if (result.err) {
          throw new Error(result.err)
        }

        // Update progress
        const progress = Math.round(((chunkIndex + 1) / totalChunks) * 100)
        setUploadProgress(progress)
      }

      setSelectedFile(null)
      setUploadProgress(0)

      // Refresh file list
      await fetchProposalFiles()
      return { fileName: selectedFile.name };
    };

    try {
      await notify.promise(
        uploadFile(),
        {
          pending: `Uploading ${selectedFile.name}... 📤`,
          success: (data) => `📁 File "${data.fileName}" uploaded successfully!`,
          error: (error) => `Upload failed: ${error.message}`
        }
      );
    } catch (error) {
      console.error("Upload error:", error)
    } finally {
      setIsUploading(false)
    }
  }

  // Function to download a file
  const handleFileDownload = async (fileName, fileType) => {
    if (!id) return

    const downloadFile = async () => {
      // Get total chunks
      const totalChunks = await icpTransfer_backend.getProposalFileTotalChunks(Number(id), fileName)

      console.log("Total chunks:", totalChunks)

      if (totalChunks === 0) {
        throw new Error("File not found or has no chunks")
      }

      // Download all chunks
      const chunks = []
      for (let i = 0; i < totalChunks; i++) {
        const chunkResult = await icpTransfer_backend.getProposalFileChunk(Number(id), fileName, i)
        console.log("Chunk result:", chunkResult)
        if (chunkResult) {
          chunks.push(chunkResult[0].chunk)
        }
      }

      console.log("Chunks:", chunks)

      // Combine chunks and create download link
      const blob = new Blob(chunks, { type: fileType })
      const url = URL.createObjectURL(blob)

      const a = document.createElement("a")
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()

      // Clean up
      setTimeout(() => {
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }, 100)

      return { fileName };
    };

    try {
      await notify.promise(
        downloadFile(),
        {
          pending: 'Preparing download... ⬇️',
          success: (data) => `📥 Download complete: ${data.fileName}`,
          error: (error) => `Download failed: ${error.message}`
        }
      );
    } catch (error) {
      console.error("Download error:", error)
    }
  }

  // Function to delete a file
  const handleFileDelete = async (fileName) => {
    if (!actor || !id) return

    if (!confirm(`Are you sure you want to delete "${fileName}"?`)) {
      return
    }

    const deleteFile = async () => {
      const result = await actor.deleteProposalFile(Number(id), fileName)

      if (result.ok) {
        // Refresh file list
        await fetchProposalFiles()
        return { fileName };
      } else {
        throw new Error(result.err || "Unknown error");
      }
    };

    try {
      await notify.promise(
        deleteFile(),
        {
          pending: 'Deleting file... 🗑️',
          success: (data) => `🗑️ File "${data.fileName}" deleted successfully`,
          error: (error) => `Delete failed: ${error.message}`
        }
      );
    } catch (error) {
      console.error("Delete error:", error)
    }
  }

  const progressPercentage = useMemo(() => {
    if (proposal && proposal.amount_raised && proposal.amount_required) {
      return (proposal.amount_raised / proposal.amount_required) * 100
    }
    return 0
  }, [proposal])
  const isGoalReached = useMemo(() => {
    if (proposal && proposal.amount_raised && proposal.amount_required) {
      return proposal.amount_raised >= proposal.amount_required
    }
    return false
  }, [proposal])
  const isCreator = useMemo(() => {
    if (proposal && proposal.created_by_text && principal) {
      return proposal.created_by_text === principal
    }
    return false
  }, [proposal, principal])
  const canClaim = useMemo(() => {
    if (proposal && proposal.amount_raised && proposal.amount_required) {
      return isGoalReached && isCreator && !proposal.claimed && proposal.amount_raised > 0
    }
    return false
  }, [isGoalReached, isCreator, proposal])
  const remainingToFund = useMemo(() => {
    if (proposal && proposal.amount_required && proposal.amount_raised) {
      return Math.max(0, proposal.amount_required - proposal.amount_raised)
    }
    return 0
  }, [proposal])

  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
      </div>
    )
  }

  if (!proposal) {
    return (
      <div style={{ textAlign: "center", padding: "20px", color: "#ffffff" }}>
        <h2 style={{ fontSize: "24px", fontWeight: "bold" }}>Proposal not found</h2>
        <p style={{ marginTop: "10px", color: "#b0b0b0" }}>
          The proposal you're looking for doesn't exist or has been removed.
        </p>
        <button
          onClick={() => window.history.back()}
          style={{
            marginTop: "20px",
            padding: "10px 20px",
            backgroundColor: "#62d9aa",
            color: "white",
            border: "none",
            borderRadius: "5px",
            cursor: "pointer",
          }}
        >
          Go Back
        </button>
      </div>
    )
  }

  return (
    <div className="proposal-details">
      <div className="left-section">
        <div className="proposal-image-section">
          <img src={proposal.image || "/placeholder.svg"} alt={proposal.title} />
        </div>

        <div className="proposal-meta">
          <h1 style={{ fontSize: "28px", fontWeight: "bold", marginBottom: "10px" }}>{proposal.title}</h1>
          <p style={{ color: "#b0b0b0", marginBottom: "15px" }}>Created by {proposal.name}</p>

          {/* File Upload Section - Only visible to creator */}
          {isCreator && (
            <div className="file-upload-section">
              <h3>Upload Files</h3>
              <div className="file-input-container">
                <input type="file" onChange={handleFileChange} className="file-input" disabled={isUploading} />
              </div>

              {selectedFile && (
                <div style={{ marginTop: "10px", color: "#b0b0b0" }}>
                  Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(2)} KB)
                </div>
              )}

              {isUploading && (
                <div style={{ marginTop: "15px" }}>
                  <div style={{ height: "6px", backgroundColor: "#1f1f21", borderRadius: "3px", overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${uploadProgress}%`,
                        backgroundColor: "#62d9aa",
                        transition: "width 0.3s ease",
                      }}
                    ></div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: "12px", color: "#b0b0b0", marginTop: "5px" }}>
                    {uploadProgress}%
                  </div>
                </div>
              )}

              <button onClick={handleFileUpload} className="upload-button" disabled={!selectedFile || isUploading}>
                {isUploading ? "Uploading..." : "Upload File"}
              </button>
            </div>
          )}

          <div className="proposal-story">
            <h2 style={{ fontSize: "20px", fontWeight: "bold", marginBottom: "15px" }}>Story</h2>
            <p style={{ whiteSpace: "pre-line", lineHeight: "1.6" }}>{proposal.description}</p>
          </div>

          {/* Files Section */}
          <div className="proposal-files">
            <h2 style={{ fontSize: "20px", fontWeight: "bold", marginBottom: "15px" }}>Project Files</h2>

            {isLoadingFiles ? (
              <div style={{ textAlign: "center", padding: "30px 0" }}>
                <div className="spinner"></div>
                <p style={{ marginTop: "15px", color: "#b0b0b0" }}>Loading files...</p>
              </div>
            ) : proposalFiles.length > 0 ? (
              <div className="file-list">
                {proposalFiles.map((file, index) => (
                  <div key={index} className="file-item">
                    <div className="file-info">
                      <div className="file-icon">
                        {file.fileType.startsWith("image/") ? (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                            <polyline points="21 15 16 10 5 21"></polyline>
                          </svg>
                        ) : file.fileType.startsWith("text/") ? (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="16" y1="13" x2="8" y2="13"></line>
                            <line x1="16" y1="17" x2="8" y2="17"></line>
                            <polyline points="10 9 9 9 8 9"></polyline>
                          </svg>
                        ) : (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                            <polyline points="13 2 13 9 20 9"></polyline>
                          </svg>
                        )}
                      </div>
                      <div>
                        <div className="file-name">{file.name}</div>
                        {/*<div className="file-size">{(file.size / 1024).toFixed(2)} KB</div>*/}
                      </div>
                    </div>

                    <div className="file-actions">
                      <button
                        onClick={() => handleFileDownload(file.name, file.fileType)}
                        className="file-action-button"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                          <polyline points="7 10 12 15 17 10"></polyline>
                          <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        Download
                      </button>

                      {isCreator && (
                        <button
                          onClick={() => handleFileDelete(file.name)}
                          className="file-action-button delete-button"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                          </svg>
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-files">
                <div className="empty-files-icon">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="40"
                    height="40"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                    <polyline points="13 2 13 9 20 9"></polyline>
                  </svg>
                </div>
                <p>No files have been uploaded for this project yet.</p>
                {isCreator && (
                  <p style={{ fontSize: "14px", marginTop: "10px" }}>Upload files to share with your supporters.</p>
                )}
              </div>
            )}
          </div>


        </div>
      </div>

      <div className="right-section">
        {!proposal.claimed && <div className="proposal-funding">
          <h2 style={{ fontSize: "20px", fontWeight: "bold", marginBottom: "15px" }}>Funding Status</h2>

          <div style={{ marginBottom: "15px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
              <span style={{ color: "#b0b0b0" }}>Goal</span>
              <span style={{ fontWeight: "bold" }}>{proposal.amount_required.toFixed(8)} ICP</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
              <span style={{ color: "#b0b0b0" }}>Raised</span>
              <span style={{ fontWeight: "bold" }}>{proposal.amount_raised.toFixed(8)} ICP</span>
            </div>
          </div>

          <div className="progress-container">
            <div
              className="progress-bar"
              style={{ width: `${progressPercentage}%` }}
              role="progressbar"
              aria-valuenow={progressPercentage}
              aria-valuemin={0}
              aria-valuemax={100}
            ></div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "14px",
              marginTop: "8px",
              color: "#b0b0b0",
            }}
          >
            <span>{progressPercentage.toFixed(1)}%</span>
            <span>{remainingToFund.toFixed(8)} ICP to go</span>
          </div>

          {isGoalReached && (
            <div
              style={{
                textAlign: "center",
                padding: "10px",
                backgroundColor: "#1f1f21",
                borderRadius: "5px",
                marginTop: "15px",
                color: "#62d9aa",
              }}
            >
              Goal Reached!
            </div>
          )}

          {isGoalReached && proposal.claimed && (
            <div
              style={{
                textAlign: "center",
                padding: "10px",
                backgroundColor: "#1f1f21",
                borderRadius: "5px",
                marginTop: "10px",
                color: "#62d9aa",
              }}
            >
              Funds Claimed
            </div>
          )}
        </div>}

        {/* Claim Funds Section - Only visible to creator when goal is reached and not claimed */}
        {canClaim && (
          <div className="proposal-funding">
            <h2 style={{ fontSize: "20px", fontWeight: "bold", marginBottom: "15px" }}>Claim Funds</h2>
            <div
              style={{
                padding: "10px",
                backgroundColor: "#1f1f21",
                borderRadius: "5px",
                marginBottom: "15px",
                color: "#62d9aa",
              }}
            >
              As the creator, you can now claim {proposal.amount_raised.toFixed(8)} ICP
            </div>

            <button onClick={handleClaimClick} className="fund-button" disabled={isClaiming}>
              {isClaiming ? "Processing..." : "Claim Funds"}
            </button>
          </div>
        )}

        {/* Donate Section - Only visible when goal is not reached */}
        {!isGoalReached && !proposal.claimed && (
          <div className="proposal-funding">
            <h2 style={{ fontSize: "20px", fontWeight: "bold", marginBottom: "15px" }}>Donate</h2>

            <div>
              <label style={{ display: "block", marginBottom: "8px", color: "#b0b0b0" }}>Amount (ICP)</label>
              <input
                type="text"
                placeholder="0.0001"
                min="0.0001"
                max={remainingToFund.toFixed(8)}
                step="0.0001"
                value={amount}
                onChange={handleInputChange}
                style={{
                  width: "100%",
                  padding: "10px",
                  backgroundColor: "#1f1f21",
                  border: "none",
                  borderRadius: "5px",
                  color: "#ffffff",
                  marginBottom: "10px",
                }}
                disabled={isSyncing}
              />
              <p style={{ fontSize: "12px", color: "#b0b0b0", marginBottom: "15px" }}>
                Maximum: {remainingToFund.toFixed(8)} ICP
              </p>
            </div>

            <button onClick={handleDonateClick} className="fund-button" disabled={isSyncing}>
              {isSyncing ? "Processing..." : "Fund Campaign"}
            </button>
          </div>
        )}

        {proposal.claimed && (
          <div className="proposal-funding">
            <h2 style={{ fontSize: "20px", fontWeight: "bold", marginBottom: "15px" }}>Claimed</h2>
            <p>The funds have been claimed by the creator.</p>
          </div>
        )}

        <div style={{ marginTop: "20px" }} className="transactions-section">
          <h2>Transaction History</h2>
          <p className="section-description">All transactions related to this proposal</p>

          <div className="transactions-container">
            <div className="transactions-header">
              <div className="transaction-cell">Account ID</div>
              <div className="transaction-cell">Amount</div>
              <div className="transaction-cell">Type</div>
            </div>

            {proposal.donations && proposal.donations.length > 0 ? (
              <div className="transactions-body">
                {proposal.donations.map((transaction) => (
                  <div
                    key={transaction.id}
                    className="transaction-row clickable"
                    onClick={() => window.open(`https://dashboard.internetcomputer.org/transaction/${transaction.id}`, '_blank')}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="transaction-cell from" data-label="Account ID:">
                      <div className="account-info">
                        <div className="account-id">
                          {transaction.accountId && transaction.accountId.length > 10
                            ? `${transaction.accountId.substring(0, 10)}...`
                            : transaction.accountId}
                        </div>
                        <div className="transaction-date">
                          {formatDate(transaction.timestamp)}
                        </div>
                      </div>
                    </div>
                    <div className="transaction-cell amount" data-label="Amount:">
                      {transaction.amount.toFixed(4)} ICP
                    </div>
                    <div
                      className={`transaction-cell type ${getTransactionClass(transaction.type)}`}
                      data-label="Type:"
                    >
                      {getTransactionIcon(transaction.type)}
                      {getTransactionType(transaction.type)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="no-transactions">
                <p>No transactions found for this proposal.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default DonateProposal

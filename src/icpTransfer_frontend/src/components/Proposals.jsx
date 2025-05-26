import React, { useState, useEffect } from 'react';
import { Actor, HttpAgent } from '@dfinity/agent';
import { icpTransfer_backend, createActor } from "../../../declarations/icpTransfer_backend";
import { Link } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { AuthClient } from "@dfinity/auth-client";

const Proposals = ({ notify, actor }) => {
  const [proposals, setProposals] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  async function bufferToBase64(buffer) {
    // use a FileReader to generate a base64 data URI:
    const base64url = await new Promise(r => {
      const reader = new FileReader()
      reader.onload = () => r(reader.result)
      reader.readAsDataURL(new Blob([buffer]))
    });
    // remove the `data:...;base64,` part from the start
    return base64url.slice(base64url.indexOf(',') + 1);
  }

  useEffect(() => {
    const fetchProposals = async () => {
      if (actor !== null) {
        const loadProposals = async () => {
          console.log("Starting to load proposals...");
          setIsLoading(true);

          const allProposals = [];
          let res = await actor.getLatestMyProposals(0, 10);

          if (res.ok) {
            allProposals.push(...res.ok);
          }

          if (allProposals.length == 10) {
            while (true) {
              res = await actor.getLatestMyProposals(allProposals.length, 10);
              if (res.ok) {
                allProposals.push(...res.ok);
                if (res.ok.length < 10) {
                  break;
                }
              } else {
                break;
              }
            }
          }

          console.log("API response:", allProposals);

          const props = await Promise.all(res.ok.map(async (val) => {
            const image = await icpTransfer_backend.getProposalImage(val.index);
            var b64 = "data:image/webp;base64," + (image.length > 0 ? await bufferToBase64(image[0]) : "");
            console.log({ ...val, image: b64 });
            return { ...val, image: b64, created_by_text: Principal.from(val.created_by).toString(), amount_required: Number(val.amount_required) / 10 ** 8 };
          }));
          setProposals(props);
          console.log("Processed proposals:", props);

          const result = { proposals: props, count: props.length };
          console.log("Returning result:", result);
          return result;

        };

        try {
          console.log("About to call notify.promise");
          const result = await notify.promise(
            loadProposals(),
            {
              pending: 'Loading your proposals... 📋',
              success: (data) => {
                console.log("Success callback called with data:", data);
                if (data && data.count > 0) {
                  return `📋 Loaded ${data.count} proposal${data.count > 1 ? 's' : ''}`;
                } else {
                  return "You haven't created any proposals yet";
                }
              },
              error: (error) => {
                console.log("Error callback called with error:", error);
                return `Failed to load proposals: ${error.message}`;
              }
            }
          );
          console.log("Promise resolved with result:", result);
        } catch (error) {
          console.error("Promise rejected with error:", error);
        } finally {
          setIsLoading(false);
        }
      } else {
        notify.warning("Please login to view your proposals");
        setIsLoading(false);
      }
    };

    fetchProposals();
  }, [actor, notify]);

  return (
    <div className="proposals-container">
      <h1>My Proposals</h1>
      {isLoading ? (
        <div className="loading-message">
          <p>Loading your proposals...</p>
        </div>
      ) : (
        <>
          <div className="proposals-grid">
            {proposals.map((proposal, index) => (
              <Link
                to={`/proposal/${proposal.index}`}  // Pass the index via the URL
                key={index}
                className="proposal-card"
              >
                <div className="proposal-image">
                  <img src={proposal.image} alt='Proposal' />
                </div>
                <div className="proposal-content">
                  <h2>{proposal.title}</h2>
                  <p><strong>Goal:</strong> {Number(proposal.amount_required)} ICP</p>
                  <p><strong>By:</strong> {proposal.name}</p>
                </div>
              </Link>
            ))}
          </div>
          {proposals.length == 0 && <h1>No Proposals have been created yet</h1>}
        </>
      )}
    </div>
  );
};

export default Proposals;

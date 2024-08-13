import { canisterId, icpTransfer_backend, idlFactory } from '../../../declarations/icpTransfer_backend';
import PlugConnect from '@psychedelic/plug-connect';

export const ConnectBtn = ({ isConnected, principal, setPrincipal, setAccountId, setIsConnected, setActor }) => {
    const whitelist = [canisterId];

    return isConnected ? <button>{principal}</button> : <PlugConnect whitelist={whitelist} onConnectCallback={
        async () => {
            setIsConnected(true)
            setPrincipal(window.ic.plug.principalId)
            setAccountId(window.ic.plug.accountId)
            if (process.env.DFX_NETWORK == "local") {
                const actor = icpTransfer_backend;
                setActor(actor)
            } else {
                const actor = await window.ic.plug.createActor({ canisterId: canisterId, interfaceFactory: idlFactory });
                setActor(actor)
            }
        }
    } />
    // return <button onClick={handleClick}>{!isPlugAvailable ? "Install Plug" : !isConnected ? "Connect" : principal}</button>
}
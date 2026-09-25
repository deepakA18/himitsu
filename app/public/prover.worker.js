/* Public worker: note secrets stay in browser memory and never enter an HTTP request. */
importScripts('/proving/snarkjs.min.js');
self.onmessage = async ({data}) => {
  try {
    const {proof,publicSignals} = await snarkjs.groth16.fullProve(data.input,data.wasm,data.zkey,undefined,undefined,{singleThread:true});
    const encoded = await snarkjs.groth16.exportSolidityCallData(proof,publicSignals);
    const words=encoded.match(/0x[0-9a-fA-F]+/g).slice(0,8);
    self.postMessage({proof:'0x'+words.map(w=>BigInt(w).toString(16).padStart(64,'0')).join('')});
  } catch (e) { self.postMessage({error:e.message || 'Proof generation failed'}); }
};

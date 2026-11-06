/** Concept diagrams explain product relationships; they do not represent live transactions. */
export function RecordDiagram({ kind }: { kind: "globe" | "layers" | "network" }) {
  return <svg viewBox="0 0 400 280" className="record-diagram" role="img" aria-label={kind === "globe" ? "Concept: a USDT payment across a globe" : kind === "layers" ? "Concept: invoice, claim and settlement layers" : "Concept: business, buyer, investor and agent connected by a record"}>
    {kind === "globe" ? <>
      <defs><pattern id="globe-dots" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#050505" opacity=".3" /></pattern></defs>
      <ellipse cx="193" cy="178" rx="146" ry="123" fill="url(#globe-dots)" stroke="#E8E9EC" />
      {[40,80,120].map(width => <ellipse key={width} cx="193" cy="178" rx={width} ry="123" fill="none" stroke="#E8E9EC" />)}
      <path d="M49 158C124 187 264 187 338 158M66 117C130 138 248 138 319 117M62 224C137 246 259 246 324 224" fill="none" stroke="#E8E9EC" />
      <path d="M71 215C68 91 266 35 325 129" fill="none" stroke="#050505" strokeWidth="1.5" strokeDasharray="3 5" /><circle cx="71" cy="215" r="4" fill="#050505" /><circle cx="325" cy="129" r="4" fill="#050505" />
      <rect x="179" y="70" width="68" height="28" rx="8" fill="#050505" /><text x="213" y="88" textAnchor="middle" fill="white" fontSize="11" fontFamily="sans-serif">USDT ↗</text>
    </> : kind === "layers" ? <>
      {[0,1,2].map(i => <g key={i} transform={`translate(0 ${i*43})`}><path d="M62 104L198 39L338 104L201 174Z" fill="white" stroke="#050505" opacity={1-i*.17} /><path d="M62 104V111L201 181L338 111V104M201 174V181" fill="none" stroke="#050505" opacity=".3" /><text x="199" y="108" textAnchor="middle" fontSize="11" fill="#050505" fontFamily="sans-serif">{["INVOICE", "CLAIM", "SETTLEMENT"][i]}</text></g>)}
      <path d="M67 245H153M68 244C101 244 128 232 150 207" fill="none" stroke="#548CFF" strokeWidth="2" /><text x="67" y="265" fontSize="9" fill="#595959" fontFamily="sans-serif">Illustrative discount curve</text>
    </> : <>
      <g fill="none" stroke="#050505" opacity=".3"><path d="M99 62C176 62 139 142 201 142M305 62C229 62 264 142 201 142M99 224C176 224 139 142 201 142M305 224C229 224 264 142 201 142" /></g>
      {[[48,43,"Business"],[251,43,"Investor"],[48,205,"Buyer"],[251,205,"Agent"]].map(([x,y,label])=><g key={label}><rect x={x} y={y} width="102" height="38" rx="10" fill="white" stroke="#E8E9EC" /><text x={Number(x)+51} y={Number(y)+24} textAnchor="middle" fontSize="11" fontFamily="sans-serif" fill="#050505">{label}</text></g>)}
      <rect x="156" y="119" width="90" height="46" rx="12" fill="#050505" /><text x="201" y="146" textAnchor="middle" fontSize="11" fill="white" fontFamily="sans-serif">Record</text><circle cx="158" cy="139" r="3" fill="#548CFF" /><circle cx="244" cy="145" r="3" fill="#548CFF" />
    </>}
  </svg>;
}

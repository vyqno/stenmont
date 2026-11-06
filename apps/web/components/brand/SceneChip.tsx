/** Original monochrome business-record drawings; no reference image subjects/assets reused. */
export function SceneChip({ kind = "invoice" }: { kind?: "invoice" | "receipt" | "certificate" | "store" | "passkey" }) {
  return <svg viewBox="0 0 320 180" className={`scene-chip scene-${kind}`} aria-hidden="true" focusable="false">
    <defs><pattern id={`scan-${kind}`} width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 1H4" stroke="#050505" strokeWidth=".5" opacity=".18" /></pattern></defs>
    <rect width="320" height="180" rx="22" fill="#E8E9EC" />
    {kind === "passkey" ? <>
      <rect x="103" y="25" width="114" height="132" rx="18" fill="white" stroke="#050505" strokeWidth="2" />
      <path d="M140 38H180M145 145H175" stroke="#050505" strokeWidth="2" />
      <circle cx="160" cy="81" r="22" fill={`url(#scan-${kind})`} stroke="#050505" strokeWidth="2" />
      <path d="M148 83C148 65 172 65 172 83V101M153 91V81C153 71 167 71 167 81V108M159 80V114M147 97V107" fill="none" stroke="#050505" strokeWidth="2" />
      <path d="M69 66L48 90L69 114M251 66L272 90L251 114" fill="none" stroke="#050505" />
    </> : kind === "store" ? <>
      <path d="M68 71H252V152H68Z" fill="white" stroke="#050505" strokeWidth="2" /><path d="M58 71L78 37H242L262 71Z" fill={`url(#scan-${kind})`} stroke="#050505" strokeWidth="2" />
      <path d="M78 37H242M92 71V37M126 71V37M160 71V37M194 71V37M228 71V37M87 128H170M87 103H170M190 89H234V152" fill="none" stroke="#050505" strokeWidth="2" />
      <rect x="95" y="90" width="27" height="13" fill="#E8E9EC" stroke="#050505" /><rect x="135" y="112" width="25" height="16" fill="#E8E9EC" stroke="#050505" />
    </> : <>
      <g transform={kind === "receipt" ? "translate(30 -5) rotate(7 160 90)" : "rotate(-8 160 90)"}>
        <path d="M96 24H209L227 43V153H96Z" fill="white" stroke="#050505" strokeWidth="2" />
        <path d="M209 24V43H227M112 52H174M112 68H211M112 80H201M112 92H211M112 104H184" fill="none" stroke="#050505" strokeWidth="2" />
        <rect x="112" y="118" width="99" height="20" fill={`url(#scan-${kind})`} stroke="#050505" strokeWidth="1.5" />
        {kind === "certificate" && <><circle cx="196" cy="131" r="22" fill="white" stroke="#050505" strokeWidth="2" /><path d="M186 131L194 139L207 121M186 150L181 171L196 164L207 173L208 150" fill="none" stroke="#050505" strokeWidth="2" /></>}
      </g>
      <path d="M63 57H84M55 70H80M239 104H264M241 117H274M67 130H82" stroke="#050505" opacity=".5" />
    </>}
  </svg>;
}

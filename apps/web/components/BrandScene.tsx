/** Original conceptual record scenes. These are illustrations, never product captures. */
export function BrandScene({ scene, className = "" }: { scene: "invoice" | "dispatch" | "records"; className?: string }) {
  return (
    <svg viewBox="0 0 240 160" className={className} aria-hidden="true" focusable="false">
      <rect width="240" height="160" rx="16" fill="#E8E9EC" />
      <path d="M0 128H240M24 0V160M216 0V160" stroke="#050505" opacity=".12" />
      {scene === "invoice" ? <>
        <path d="M74 22H157L174 39V140H74Z" fill="#FFFFFF" stroke="#050505" strokeWidth="2" />
        <path d="M157 22V39H174M90 50H137M90 66H158M90 78H146M90 90H158" fill="none" stroke="#050505" strokeWidth="2" />
        <path d="M90 108H158V126H90Z" fill="#548CFF" stroke="#050505" strokeWidth="2" />
        <path d="M44 43V97M35 52L44 43L53 52M190 78V122M181 113L190 122L199 113" fill="none" stroke="#050505" strokeWidth="2" />
      </> : scene === "dispatch" ? <>
        <path d="M36 64L85 40L134 64L85 90Z" fill="#FFFFFF" stroke="#050505" strokeWidth="2" />
        <path d="M36 64V113L85 138V90M85 138L134 113V64" fill="#548CFF" stroke="#050505" strokeWidth="2" />
        <path d="M61 52L110 77V101M153 51H209M153 65H194M153 79H209" fill="none" stroke="#050505" strokeWidth="2" />
        <rect x="159" y="100" width="49" height="30" rx="4" fill="#FFFFFF" stroke="#050505" strokeWidth="2" />
        <path d="M172 115L181 122L196 108" fill="none" stroke="#050505" strokeWidth="2" />
      </> : <>
        <path d="M44 40H196V130H44Z" fill="#FFFFFF" stroke="#050505" strokeWidth="2" />
        <path d="M44 64H196M89 64V130M44 86H196M44 108H196" stroke="#050505" strokeWidth="2" />
        <rect x="108" y="73" width="66" height="6" fill="#548CFF" /><rect x="108" y="95" width="45" height="6" fill="#548CFF" />
        <path d="M59 75H74M59 97H74M59 119H74M108 119H174" stroke="#050505" strokeWidth="2" />
      </>}
    </svg>
  );
}

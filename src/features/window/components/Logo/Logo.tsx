/** The shield with the crosshair: the title bar, the page header. */
export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 1.5 2.5 4.8v6.4c0 5.6 4 10.1 9.5 11.3 5.5-1.2 9.5-5.7 9.5-11.3V4.8z" fill="#e7b324" />
      <circle cx="12" cy="11.6" r="4.3" fill="none" stroke="#141310" strokeWidth="2" />
      <path d="M12 4.8v3.4M12 15v3.4M5.2 11.6h3.4M15.4 11.6h3.4" stroke="#141310" strokeWidth="2" />
    </svg>
  )
}

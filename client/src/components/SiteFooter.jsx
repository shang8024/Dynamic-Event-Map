export default function SiteFooter({map=false}) {
  return <footer className="site-footer">
    {map&&<p className="map-source-note">Explore the GTA · Times are shown in EDT.</p>}
    <a className="footer-report-link" href="https://docs.google.com/forms/d/e/1FAIpQLScBp0nf1LZFmlKOqys0B_fuCKH5cK-PGB-QGMnNDit77tgJ4g/viewform?hl=en" target="_blank" rel="noopener noreferrer"
      title="Report an event, request a correction or ask to manage a listing" aria-label="Report abuse (opens a Google Form in a new tab)">Report abuse</a>
  </footer>;
}

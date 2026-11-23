# Certificate Trail

<!-- coolcode:guide -->
Enter a domain, then filter certificate names and issuers or export matching records as CSV. If the live query fails, import a crt.sh JSON array for the same domain; validity dates and CT history do not establish current deployment or revocation status.
<!-- /coolcode:guide -->

Explore the public TLS certificate history of a domain or subdomain from a statically hosted browser app. Search live with crt.sh or enter the domain and import a crt.sh JSON array on the device. A validity-start-year timeline, name and issuer filters, deduplicated certificate records, name counts and a filtered CSV export help make historical results readable.

## Build and test

```sh
python3 scripts/build.py
node --test tests/*.test.mjs
python3 -m http.server --directory dist 8000
```

The API query searches the submitted identity and descendants. Results are filtered again by DNS-label boundary. Imports use the same scope filter. Rows with the same issuer and serial are grouped and name sets are merged. The displayed first log entry is the earliest such timestamp across the matching source copies when available. Dates show UTC; the timeline uses certificate validity start dates. Requests time out after 24 seconds and are bounded to 8 MB and 20,000 source rows. The source JSON link or local import can be used when the browser query fails.

[crt.sh](https://crt.sh/) provides the searchable records. Its community-maintained JSON interface is [undocumented](https://groups.google.com/g/crtsh/c/IIb3h_v-P20/m/PJfiOc5PFQAJ). CT history and validity dates do not establish that a service is available, currently uses the certificate, or has not revoked it. See [RFC 9162](https://www.rfc-editor.org/rfc/rfc9162.html) for protocol background. The project does not mirror crt.sh data.

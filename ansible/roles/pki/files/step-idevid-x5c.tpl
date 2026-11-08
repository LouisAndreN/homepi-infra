{{- /* HomePi: bind the issued certificate to the IDevID identity (B3.3). */ -}}
{{- $id := .AuthorizationCrt.Subject.CommonName -}}
{{- if not (regexMatch "^esp32-[0-9a-f]{8}$" $id) -}}
  {{- fail "IDevID common name is not a valid device identifier" -}}
{{- end -}}
{{- if ne .Subject.CommonName $id -}}
  {{- fail "requested subject does not match the IDevID" -}}
{{- end -}}
{{- range .SANs -}}
  {{- if ne .Value $id -}}
    {{- fail "requested SAN does not match the IDevID" -}}
  {{- end -}}
{{- end -}}
{
  "subject": {"commonName": {{ toJson $id }}},
  "sans": [{"type": "dns", "value": {{ toJson $id }}}],
  "keyUsage": ["digitalSignature"],
  "extKeyUsage": ["clientAuth"]
}

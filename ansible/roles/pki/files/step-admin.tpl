{{- /* HomePi: the admin provisioner may only issue the server names in use (B3.3). */ -}}
{{- $names := list "homepi.internal" "homepi" "*.homepi.internal" "127.0.0.1" "192.168.200.1" "192.168.0.151" -}}
{{- $sub := "^[a-z0-9-]+\\.homepi\\.internal$" -}}
{{- if not (or (has .Subject.CommonName $names) (regexMatch $sub .Subject.CommonName)) -}}
  {{- fail "subject not allowed for the admin provisioner" -}}
{{- end -}}
{{- range .SANs -}}
  {{- if not (or (has .Value $names) (regexMatch $sub .Value)) -}}
    {{- fail "SAN not allowed for the admin provisioner" -}}
  {{- end -}}
{{- end -}}
{
  "subject": {{ toJson .Subject }},
  "sans": {{ toJson .SANs }},
  "keyUsage": ["digitalSignature"],
  "extKeyUsage": ["serverAuth", "clientAuth"]
}

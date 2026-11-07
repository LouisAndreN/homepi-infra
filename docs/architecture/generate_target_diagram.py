#!/usr/bin/env python3
"""Generate docs/architecture/homepi-target-architecture-v1.drawio (diagram as code).

Usage: python3 docs/architecture/generate_target_diagram.py docs/architecture/homepi-target-architecture-v1.drawio

Each box carries its status: B = built and verified, P("X1") = planned in roadmap step X1.
Moving a step to green is a one-line change here; the .drawio opens in diagrams.net with the
official AWS icons (mxgraph.aws4).
"""
from xml.sax.saxutils import escape
cells=[]; n=[0]
def nid(p): n[0]+=1; return f"{p}{n[0]}"
ICON="sketch=0;points=[];outlineConnect=0;fontColor=#232F3E;fillColor={c};strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=11;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.{r};"
GRP="points=[];outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=12;fontStyle=1;shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.{g};strokeColor={s};fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor={f};dashed={d};"
OU="rounded=0;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#545B64;dashed=1;dashPattern=8 4;verticalAlign=top;align=left;spacingLeft=8;spacingTop=4;fontSize=12;fontStyle=1;fontColor=#545B64;"
BOX="rounded=1;whiteSpace=wrap;html=1;fillColor=#F2F3F3;strokeColor=#7D8998;fontColor=#232F3E;fontSize=11;align={a};verticalAlign={v};spacing=8;"
E="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;strokeColor={c};fontSize=10;labelBackgroundColor=#FFFFFF;{x}"
B='<font color="#1D8102"><b>&#9679; built</b></font>'
def P(p): return f'<font color="#D45B07"><b>&#9675; {p}</b></font>'
def v(style,value,x,y,w,h,pre="v"):
    i=nid(pre); cells.append(f'<mxCell id="{i}" value="{escape(value,{chr(34):"&quot;"})}" style="{style}" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>'); return i
def icon(c,r,label,x,y): return v(ICON.format(c=c,r=r),label,x,y,60,60,"i")
def e(s,t,label="",color="#545B64",extra="",pts=()):
    i=nid("e"); p="".join(f'<mxPoint x="{a}" y="{b}"/>' for a,b in pts)
    p=f'<Array as="points">{p}</Array>' if pts else ""
    cells.append(f'<mxCell id="{i}" value="{escape(label)}" style="{E.format(c=color,x=extra)}" edge="1" parent="1" source="{s}" target="{t}"><mxGeometry relative="1" as="geometry">{p}</mxGeometry></mxCell>')
SEC,MGT,STO="#DD344C","#E7157B","#7AA116"
v("text;html=1;align=left;verticalAlign=middle;fontSize=20;fontStyle=1;fontColor=#232F3E;","HomePi: target architecture v1 (edge platform + AWS landing zone), status 2026-11-07",20,10,900,36)
v("text;html=1;align=left;verticalAlign=top;fontSize=11;fontColor=#545B64;whiteSpace=wrap;","<b>SCP guardrails</b> on both OUs "+P("D4")+": Tokyo region only (global services exempt), deny leaving the organization, deny stopping or deleting CloudTrail, deny root user in member accounts, deny s3:BypassGovernanceRetention. No workload runs in the management account.",20,50,1000,50)
v(BOX.format(a="left",v="top"),"<b>Legend</b><br>"+B+" exists and is verified<br>"+P("A1")+" planned, roadmap step (docs/roadmap.md)<br>Solid arrow: data or control flow<br>Dashed arrow: restore or break-glass path",1450,8,400,92)
# home
v(GRP.format(g="group_corporate_data_center",s="#7D8998",f="#5A6C86",d=0),"Home (on-premises, Japan)",20,110,340,1010)
esp=v(BOX.format(a="center",v="middle"),"<b>ESP32 sensors</b><br>isolated IoT Wi-Fi 192.168.200.0/24<br>MQTT over mTLS, per-device X.509 "+B,40,150,290,70)
pi=v(BOX.format(a="left",v="top").replace("#F2F3F3","#E9F5E1").replace("#7D8998","#7AA116"),
 "<b>Raspberry Pi 5 &mdash; HomePi</b> (LUKS2 NVMe, LVM)<br>"
 "<b>Data</b>: Mosquitto mTLS, Telegraf, InfluxDB "+B+"<br>"
 "<b>Observability</b>: Prometheus, Alertmanager, Loki, Alloy, Grafana "+B+"<br>"
 "<b>Access</b>: Nginx, Authelia 2FA, CrowdSec, NetBird "+B+"<br>"
 "<b>PKI</b>: step-ca "+B+" &nbsp;<b>Edge AI</b>: Hailo-8L "+B+"<br>"
 "<b>DNS</b>: Unbound as system resolver "+B+"<br><br>"
 "<b>Operations</b><br>"
 "GitOps pull from GitHub, signed tags "+B+"<br>"
 "Encrypted backups, nightly + weekly "+B+"<br>"
 "Off-site upload hourly, 36 h alert "+B+"<br>"
 "Heartbeat relay (Watchdog, 1/min) "+B+"<br>"
 "Every config managed by Ansible "+P("B")+"<br>"
 "Loki on its own XFS volume "+P("B"),40,260,290,330)
lap=v(BOX.format(a="center",v="middle"),"<b>Laptop</b><br>release signing key, SOPS age key<br>break-glass Terraform (SSO) "+B,40,720,290,80)
mail=v(BOX.format(a="center",v="middle"),"<b>Louis: e-mail on phone</b><br>independent of the Pi, its DNS and Slack "+B,40,830,290,64)
v(BOX.format(a="center",v="middle"),"<b>USB recovery key</b><br>age recovery key, runbooks "+B,40,930,140,80)
v(BOX.format(a="center",v="middle"),"<b>Spare SSD</b><br>game day: full rebuild timed vs RTO 4 h "+P("C"),190,930,140,80)
e(esp,pi,"MQTT mTLS")
# github
v("rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#24292F;verticalAlign=top;align=left;spacingLeft=10;spacingTop=6;fontSize=12;fontStyle=1;fontColor=#24292F;","GitHub",400,110,290,1010)
repo=v(BOX.format(a="center",v="middle"),"<b>Repository homepi-infra</b><br>Ansible, Terraform, docs, incidents<br>secrets SOPS-encrypted, gitleaks<br>signed tags, read-only deploy key "+B,415,150,260,100)
ci=v(BOX.format(a="center",v="middle"),"<b>CI checks on pull request</b><br>ansible-lint, yamllint, terraform validate,<br>tflint, trivy, gitleaks, promtool,<br>alloy validate "+P("D1"),415,300,260,100)
plan=v(BOX.format(a="center",v="middle"),"<b>terraform plan</b><br>on every pull request "+P("D1"),415,450,260,64)
apply=v(BOX.format(a="center",v="middle"),"<b>terraform apply</b><br>main only, protected environment,<br>manual approval "+P("D1"),415,560,260,80)
e(repo,ci); e(ci,plan); e(plan,apply,"approval")
e(repo,pi,"pull signed tags<br>(read-only deploy key)",extra="exitX=0;exitY=0.5;entryX=1;entryY=0.09;",pts=[(350,200),(350,290)])
e(lap,repo,"push signed tags",extra="exitX=1;exitY=0.31;entryX=0;entryY=0.8;",pts=[(378,745),(378,230)])
# aws
v(GRP.format(g="group_aws_cloud_alt",s="#232F3E",f="#232F3E",d=0),"AWS Cloud: organization (all workloads in ap-northeast-1)",740,110,1110,1010)
v(GRP.format(g="group_account",s="#CD2264",f="#CD2264",d=0),"Management account: louis-management",760,150,1070,170)
org=icon(MGT,"organizations","AWS Organizations "+B+"<br>SCPs "+P("D4"),820,190)
sso=icon(SEC,"single_sign_on","IAM Identity Center<br>SSO, MFA "+B,1030,190)
icon(STO,"budgets","AWS Budgets<br>cost alert "+P("verify"),1240,190)
trail=icon(MGT,"cloudtrail","CloudTrail<br>organization trail "+P("D2"),1450,190)
e(lap,sso,"aws sso login (MFA)",extra="exitX=1;exitY=0.75;entryX=0.5;entryY=1;",pts=[(715,780),(715,332),(1060,332)])
v(OU,"OU Workloads",760,345,640,765)
v(GRP.format(g="group_account",s="#CD2264",f="#CD2264",d=0),"Account: homepi",775,375,610,720)
v(GRP.format(g="group_region",s="#00A4A6",f="#147EBA",d=1),"Asia Pacific (Tokyo) ap-northeast-1",790,410,580,670)
ra=icon(SEC,"identity_and_access_management","IAM Roles Anywhere<br>trust anchor: step-ca "+B,830,455)
ew=icon(SEC,"identity_and_access_management","role edge-writer<br>PutObject, 2 prefixes "+B,1030,455)
s3b=icon(STO,"s3","S3: backups, versioning<br>SSE-S3 + client-side age<br>Object Lock "+B+"<br>COMPLIANCE "+P("D5"),1230,455)
eh=icon(SEC,"identity_and_access_management","role edge-heartbeat<br>PutMetricData HomePi "+B,1030,600)
cw=icon(MGT,"cloudwatch_2","CloudWatch alarm<br>8 empty min of 10 "+B,1230,600)
sns=icon(MGT,"sns","SNS topic<br>e-mail subscription "+B,1230,745)
oidc=icon(SEC,"identity_and_access_management","IAM OIDC provider<br>GitHub Actions "+P("D1"),830,880)
cip=icon(SEC,"identity_and_access_management","role ci-plan (read)<br>role ci-apply (env) "+P("D1"),1030,880)
tfs=icon(STO,"s3","S3: Terraform state<br>native lock file "+B,1230,880)
e(pi,ra,"X.509-signed CreateSession (SigV4, not mTLS)",extra="exitX=1;exitY=0.5;entryX=0;entryY=0.5;",pts=[(783,425),(783,485)])
e(ra,ew,"temporary credentials"); e(ew,s3b,"PutObject state/, influx-lp/")
e(ra,eh,"",extra="exitX=0.5;exitY=1;entryX=0;entryY=0.5;",pts=[(860,630)])
e(eh,cw,"Watchdog every minute"); e(cw,sns,"no heartbeat 8 of 10 min")
e(sns,mail,"e-mail",color="#E7157B",extra="exitX=0;exitY=0.5;entryX=1;entryY=0.5;",pts=[(805,775),(805,862)])
e(plan,oidc,"OIDC token",extra="exitX=1;exitY=0.5;entryX=0;entryY=0.5;",pts=[(730,482),(730,910)])
e(apply,oidc,"",extra="exitX=1;exitY=0.5;entryX=0;entryY=0.75;",pts=[(730,600),(730,925)])
e(oidc,cip,"AssumeRoleWithWebIdentity"); e(cip,tfs,"plan / apply")
v(OU,"OU Security",1420,345,410,765)
v(GRP.format(g="group_account",s="#CD2264",f="#CD2264",d=0),"Account: log-archive "+P("D2"),1435,375,380,280)
aud=icon(STO,"s3","S3: audit logs<br>Object Lock COMPLIANCE<br>readers restricted",1575,450)
v(GRP.format(g="group_account",s="#CD2264",f="#CD2264",d=0),"Account: backup-vault "+P("D3"),1435,680,380,415)
rep=icon(STO,"s3","S3: backup replica<br>Object Lock COMPLIANCE<br>no access from homepi",1575,740)
rr=icon(SEC,"identity_and_access_management","role restore-reader<br>SSO only, read-only",1575,920)
e(trail,aud,"management events, all accounts",extra="exitX=1;exitY=0.5;entryX=0.5;entryY=0;",pts=[(1605,220)])
e(s3b,rep,"cross-account replication",extra="exitX=1;exitY=0.5;entryX=0;entryY=0.5;",pts=[(1410,485),(1410,770)])
e(rep,rr,"")
e(rr,lap,"restore download (game day or real disaster)",extra="dashed=1;exitX=0;exitY=0.5;entryX=0;entryY=0.5;",pts=[(1500,950),(1500,1105),(30,1105),(30,760)])
xml='<mxfile host="app.diagrams.net"><diagram id="homepi-target" name="Target architecture v1"><mxGraphModel dx="1900" dy="1150" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1880" pageHeight="1140" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>'+"".join(cells)+'</root></mxGraphModel></diagram></mxfile>'
import sys
out = sys.argv[1] if len(sys.argv) > 1 else "homepi-target-architecture-v1.drawio"
open(out, "w", encoding="utf-8").write(xml)
print("written: %s (%d cells)" % (out, len(cells)))

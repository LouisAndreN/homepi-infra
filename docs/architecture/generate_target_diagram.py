#!/usr/bin/env python3
"""Generate docs/architecture/homepi-target-architecture-v1.drawio (diagram as code).

Usage: python3 docs/architecture/generate_target_diagram.py docs/architecture/homepi-target-architecture-v1.drawio

Two pages:
  1. "Architecture" (English): every component with its status, B = built and verified,
     P("X1") = planned in roadmap step X1 (docs/roadmap.md).
  2. "Overview (Qiita)" (Japanese): the simplified view used by the article series index.
Every arrow says how the flow happens (program, command, protocol, file). The .drawio opens in
diagrams.net with the official AWS icons (mxgraph.aws4). Status as of 2026-11-28 (v1.5.0).
"""
import sys
from xml.sax.saxutils import escape

ICON = ("sketch=0;points=[];outlineConnect=0;fontColor=#232F3E;fillColor={c};strokeColor=#ffffff;dashed=0;"
        "verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=11;fontStyle=0;aspect=fixed;"
        "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.{r};")
GRP = ("points=[];outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=12;fontStyle=1;"
       "shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.{g};strokeColor={s};fillColor=none;verticalAlign=top;"
       "align=left;spacingLeft=30;fontColor={f};dashed={d};")
OU = ("rounded=0;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#545B64;dashed=1;dashPattern=8 4;"
      "verticalAlign=top;align=left;spacingLeft=8;spacingTop=4;fontSize=12;fontStyle=1;fontColor=#545B64;")
BOX = ("rounded=1;whiteSpace=wrap;html=1;fillColor=#F2F3F3;strokeColor=#7D8998;fontColor=#232F3E;fontSize=11;"
       "align={a};verticalAlign={v};spacing=8;")
PIBOX = BOX.replace("#F2F3F3", "#E9F5E1").replace("#7D8998", "#7AA116")
GHGRP = ("rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#24292F;verticalAlign=top;align=left;"
         "spacingLeft=10;spacingTop=6;fontSize=12;fontStyle=1;fontColor=#24292F;")
EDGE = ("edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;strokeColor={c};fontSize=10;"
        "labelBackgroundColor=#FFFFFF;{x}")
TEXT = "text;html=1;align=left;verticalAlign={v};fontSize={s};fontStyle={b};fontColor={c};whiteSpace=wrap;"
SEC, MGT, STO = "#DD344C", "#E7157B", "#7AA116"
B = '<font color="#1D8102"><b>&#9679; built</b></font>'


def P(step):
    return f'<font color="#D45B07"><b>&#9675; {step}</b></font>'


class Page:
    def __init__(self):
        self.cells, self.n = [], 0

    def _id(self, prefix):
        self.n += 1
        return f"{prefix}{self.n}"

    def v(self, style, value, x, y, w, h, prefix="v"):
        i = self._id(prefix)
        self.cells.append(f'<mxCell id="{i}" value="{escape(value, {chr(34): "&quot;"})}" style="{style}" '
                          f'vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" '
                          f'as="geometry"/></mxCell>')
        return i

    def icon(self, color, res, label, x, y):
        return self.v(ICON.format(c=color, r=res), label, x, y, 60, 60, "i")

    def e(self, s, t, label="", color="#545B64", extra="", pts=(), at=None, off=None):
        """Edge from s to t; at = label position along the edge (-1 to 1), off = label offset (dx, dy)."""
        i = self._id("e")
        p = "".join(f'<mxPoint x="{a}" y="{b}"/>' for a, b in pts)
        p = f'<Array as="points">{p}</Array>' if pts else ""
        o = f'<mxPoint x="{off[0]}" y="{off[1]}" as="offset"/>' if off else ""
        pos = f' x="{at}"' if at is not None else ""
        self.cells.append(f'<mxCell id="{i}" value="{escape(label, {chr(34): "&quot;"})}" '
                          f'style="{EDGE.format(c=color, x=extra)}" edge="1" parent="1" source="{s}" target="{t}">'
                          f'<mxGeometry relative="1"{pos} as="geometry">{p}{o}</mxGeometry></mxCell>')

    def xml(self, pid, name, w, h):
        return (f'<diagram id="{pid}" name="{name}"><mxGraphModel dx="{w}" dy="{h}" grid="1" gridSize="10" '
                f'guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" '
                f'pageWidth="{w}" pageHeight="{h}" math="0" shadow="0"><root><mxCell id="0"/>'
                f'<mxCell id="1" parent="0"/>{"".join(self.cells)}</root></mxGraphModel></diagram>')


def full():
    d = Page()
    G, A = 700, 1060  # left edge of the GitHub and AWS columns (wide gaps leave room for the arrow labels)
    d.v(TEXT.format(v="middle", s=20, b=1, c="#232F3E"),
        "HomePi: architecture (edge platform + AWS organization), status 2026-11-28, v1.5.0", 20, 10, 1100, 36)
    d.v(TEXT.format(v="top", s=11, b=0, c="#545B64"),
        "<b>SCP guardrails</b> on both OUs " + B + ": Tokyo region only (global services exempt), deny leaving the "
        "organization, deny stopping or deleting CloudTrail, deny root user in member accounts, deny "
        "s3:BypassGovernanceRetention. No workload runs in the management account.", 20, 50, 1100, 50)
    d.v(BOX.format(a="left", v="top"),
        "<b>Legend</b><br>" + B + " exists and is verified<br>" + P("D1") + " planned, roadmap step (docs/roadmap.md)"
        "<br>Arrow label: how the flow happens (program, command, file)<br>Dashed arrow: planned flow or restore path",
        A + 710, 8, 420, 92)

    # Home
    d.v(GRP.format(g="group_corporate_data_center", s="#7D8998", f="#5A6C86", d=0), "Home (on-premises, Japan)",
        20, 110, 370, 1010)
    esp = d.v(BOX.format(a="center", v="middle"),
              "<b>7 x ESP32</b> (sensors, LED, NILM bridge)<br>isolated IoT Wi-Fi 192.168.200.0/24<br>"
              "IDevID + LDevID in NVS \"certs\", signed OTA " + B, 40, 150, 320, 76)
    pi = d.v(PIBOX.format(a="left", v="top").replace("fontSize=11", "fontSize=10"),
             "<b>Raspberry Pi 5 &mdash; HomePi</b> (LUKS2 NVMe, LVM, Btrfs)<br>"
             "<b>Data</b>: Mosquitto mTLS + CRL, Telegraf, InfluxDB " + B + "<br>"
             "<b>Observability</b>: Prometheus (127 rules, unit tests),<br>Alertmanager, Loki, Alloy, Grafana " + B +
             "<br><b>SLOs</b>: ingestion 99.5%, device API 99%, 28 days " + B + "<br>"
             "<b>Access</b>: nginx, Authelia 2FA, CrowdSec, NetBird,<br>nftables default-deny " + B + "<br>"
             "<b>PKI</b>: step-ca intermediate (root key offline) " + B + "<br>"
             "<b>DNS</b>: Unbound, DNSSEC " + B + "<br><br>"
             "<b>Operations</b><br>"
             "Ansible, 33 roles, every config as code " + B + "<br>"
             "GitOps: homepi-gitops-sync applies signed tags only,<br>hourly drift check " + B + "<br>"
             "Grafana as code: Terraform run by GitOps,<br>no destroy without [allow-destroy] " + B + "<br>"
             "Encrypted backups (age), nightly + off-site upload " + B + "<br>"
             "Heartbeat relay (Alertmanager Watchdog, 1/min) " + B + "<br>"
             "Loki on its own XFS volume " + B, 40, 280, 320, 370)
    lap = d.v(BOX.format(a="center", v="middle"),
              "<b>Laptop</b><br>~/homepi-infra, scripts/lib.sh (ship, release)<br>tag signing key, SOPS age key,<br>"
              "Manufacturer CA (offline), Terraform (SSO) " + B, 40, 710, 320, 96)
    mail = d.v(BOX.format(a="center", v="middle"),
               "<b>Louis: e-mail on phone</b><br>independent of the Pi, its DNS and Slack " + B, 40, 840, 320, 64)
    d.v(BOX.format(a="center", v="middle"), "<b>USB keys</b><br>age recovery key, root CA escrow " + B,
        40, 935, 150, 80)
    d.v(BOX.format(a="center", v="middle"),
        "<b>Spare SSD</b><br>game days C3 to C9: full rebuild, best 48 min 08 s " + B, 210, 935, 150, 80)
    d.e(esp, pi, "MQTT mTLS :8883 with the LDevID;<br>at boot: POST /step/sign (X5C, IDevID)")

    # GitHub
    d.v(GHGRP, "GitHub", G, 110, 290, 1010)
    repo = d.v(BOX.format(a="center", v="middle"),
               "<b>Repository homepi-infra</b><br>Ansible, Terraform, docs, incidents<br>"
               "secrets SOPS-encrypted (ansible/secrets)<br>signed tags, read-only deploy key " + B,
               G + 15, 150, 260, 100)
    ci = d.v(BOX.format(a="center", v="middle"),
             "<b>CI: .github/workflows/ci.yml</b><br>on push and tags: syntax, promtool<br>rules + unit tests, ansible "
             "syntax-check,<br>offline and root tests, changelog " + B, G + 15, 300, 260, 100)
    tfci = d.v(BOX.format(a="center", v="middle"),
               "<b>Terraform in CI</b><br>plan on pull request, apply on main<br>after approval, OIDC " + P("D1"),
               G + 15, 450, 260, 80)
    d.e(repo, ci, "every push and tag")
    d.e(ci, tfci, "", extra="dashed=1;")
    d.e(repo, pi, "homepi-gitops-sync, every 10 min:<br>git fetch (deploy key),<br>git tag -v (allowed_signers),"
        "<br>ansible-playbook site.yml",
        extra="exitX=0;exitY=0.3;entryX=1;entryY=0.1;", pts=[(500, 180), (500, 317)], at=-0.1)
    d.e(lap, repo, "ship: git merge --ff-only<br>release: git tag -s,<br>git push pi main + tag",
        extra="exitX=1;exitY=0.25;entryX=0;entryY=0.8;", pts=[(620, 734), (620, 230)], at=0.2)
    d.e(lap, pi, "same push:<br>/var/lib/homepi-gitops/origin.git", extra="exitX=0.5;exitY=0;entryX=0.5;entryY=1;")

    # AWS
    d.v(GRP.format(g="group_aws_cloud_alt", s="#232F3E", f="#232F3E", d=0),
        "AWS Cloud: organization (all workloads in ap-northeast-1)", A, 110, 1110, 1010)
    d.v(GRP.format(g="group_account", s="#CD2264", f="#CD2264", d=0), "Management account", A + 20, 150, 1070, 170)
    d.icon(MGT, "organizations", "AWS Organizations, 4 accounts " + B + "<br>SCPs " + B, A + 80, 190)
    sso = d.icon(SEC, "single_sign_on", "IAM Identity Center<br>SSO, MFA " + B, A + 290, 190)
    d.icon(STO, "budgets", "AWS Budgets<br>monthly cost alert " + B, A + 500, 190)
    trail = d.icon(MGT, "cloudtrail", "CloudTrail<br>organization trail " + B, A + 710, 190)
    d.e(lap, sso, "awsenv / awsmgmt (scripts/lib.sh):<br>aws sso login (MFA),<br>terraform apply (terraform/aws/*)",
        extra="exitX=1;exitY=0.75;entryX=0.5;entryY=1;", pts=[(A - 30, 782), (A - 30, 332), (A + 320, 332)],
        at=-0.62)

    d.v(OU, "OU Workloads", A + 20, 345, 640, 765)
    d.v(GRP.format(g="group_account", s="#CD2264", f="#CD2264", d=0), "Account: homepi", A + 35, 375, 610, 720)
    d.v(GRP.format(g="group_region", s="#00A4A6", f="#147EBA", d=1), "Asia Pacific (Tokyo) ap-northeast-1",
        A + 50, 410, 580, 670)
    ra = d.icon(SEC, "identity_and_access_management",
                "IAM Roles Anywhere<br>trust anchor: step-ca intermediate,<br>CN homepi-backup only " + B, A + 90, 455)
    ew = d.icon(SEC, "identity_and_access_management", "role edge-writer<br>s3:PutObject only " + B, A + 290, 455)
    s3b = d.icon(STO, "s3", "S3: backups, versioning<br>age-encrypted on the Pi<br>Object Lock GOVERNANCE 30 d,<br>"
                 "bypass denied by SCP " + B, A + 490, 455)
    eh = d.icon(SEC, "identity_and_access_management", "role edge-heartbeat<br>PutMetricData, HomePi only " + B,
                A + 290, 615)
    cw = d.icon(MGT, "cloudwatch_2", "CloudWatch alarm<br>no heartbeat 8 of 10 min " + B, A + 490, 615)
    el = d.icon(SEC, "identity_and_access_management", "role edge-logs<br>write the Pi log prefix only " + B,
                A + 290, 845)
    sns = d.icon(MGT, "sns", "SNS topic<br>e-mail subscription " + B, A + 490, 765)
    oidc = d.icon(SEC, "identity_and_access_management", "IAM OIDC provider<br>GitHub Actions " + P("D1"), A + 90, 940)
    cip = d.icon(SEC, "identity_and_access_management", "roles ci-plan, ci-apply " + P("D1"), A + 290, 940)
    tfs = d.icon(STO, "s3", "S3: Terraform state<br>use_lockfile, encrypted " + B, A + 490, 940)
    d.e(pi, ra, "aws_signing_helper credential-process<br>(/etc/homepi-aws/edge.crt, edge.key)",
        extra="exitX=1;exitY=0.92;entryX=0;entryY=0.5;", pts=[(A + 50, 620), (A + 50, 485)], at=-0.15)
    d.e(ra, ew, "temporary<br>credentials, 1 h")
    d.e(ew, s3b, "homepi-offsite-upload:<br>PutObject state/, influx-*/")
    d.e(ra, eh, "", extra="exitX=0.5;exitY=1;entryX=0;entryY=0.5;", pts=[(A + 120, 645)])
    d.e(ra, el, "", extra="exitX=0.5;exitY=1;entryX=0;entryY=0.5;", pts=[(A + 120, 875)])
    d.e(eh, cw, "homepi-heartbeat-relay:<br>PutMetricData every minute")
    d.e(cw, sns, "alarm state")
    d.e(sns, mail, "e-mail", color="#E7157B", extra="exitX=1;exitY=0.5;entryX=1;entryY=0.75;",
        pts=[(A + 600, 795), (A + 600, 1090), (400, 1090), (400, 888)], at=0.5)
    d.e(tfci, oidc, "OIDC token (planned)", extra="dashed=1;exitX=1;exitY=0.5;entryX=0;entryY=0.5;",
        pts=[(A - 15, 490), (A - 15, 970)], at=0.4)
    d.e(oidc, cip, "AssumeRole-<br>WithWebIdentity", extra="dashed=1;")
    d.e(cip, tfs, "plan / apply", extra="dashed=1;")

    d.v(OU, "OU Security", A + 680, 345, 410, 765)
    d.v(GRP.format(g="group_account", s="#CD2264", f="#CD2264", d=0), "Account: log-archive " + B,
        A + 695, 375, 380, 280)
    aud = d.icon(STO, "s3", "S3: CloudTrail logs<br>Object Lock", A + 740, 450)
    pil = d.icon(STO, "s3", "S3: Pi security journal<br>Object Lock", A + 950, 450)
    d.v(GRP.format(g="group_account", s="#CD2264", f="#CD2264", d=0), "Account: backup-vault " + B,
        A + 695, 680, 380, 415)
    rep = d.icon(STO, "s3", "S3: backup replica<br>Object Lock GOVERNANCE 30 d<br>no access from homepi", A + 835, 750)
    rr = d.icon(SEC, "identity_and_access_management", "permission set restore-reader<br>SSO only, read-only",
                A + 835, 930)
    d.e(trail, aud, "management events, all accounts",
        extra="exitX=1;exitY=0.5;entryX=0.5;entryY=0;", pts=[(A + 770, 220)])
    d.e(el, pil, "homepi-log-ship, every 5 min: security journal",
        extra="exitX=1;exitY=0.5;entryX=0.5;entryY=1;", pts=[(A + 665, 875), (A + 665, 625), (A + 980, 625)],
        at=0.45)
    d.e(s3b, rep, "S3 replication<br>(replication role)",
        extra="exitX=1;exitY=0.5;entryX=0;entryY=0.5;", pts=[(A + 650, 485), (A + 650, 780)], at=0.75)
    d.e(rep, rr, "")
    d.e(rr, lap, "restore (game day or disaster): SSO restore-reader, download, age decrypt on the laptop",
        extra="dashed=1;exitX=0;exitY=0.5;entryX=0;entryY=0.5;", pts=[(A + 760, 960), (A + 760, 1105),
                                                                     (30, 1105), (30, 758)], at=0.3)
    return d.xml("homepi-architecture", "Architecture", A + 1130, 1140)


def overview():
    d = Page()
    INNER = BOX.format(a="center", v="middle").replace("#F2F3F3", "#FFFFFF").replace("#7D8998", "#7AA116")
    PICONT = ("rounded=1;whiteSpace=wrap;html=1;fillColor=#E9F5E1;strokeColor=#7AA116;fontColor=#232F3E;"
              "fontSize=12;fontStyle=1;align=left;verticalAlign=top;spacingLeft=10;spacingTop=4;arcSize=3;")
    RIGHT_LABEL = "labelPosition=right;verticalLabelPosition=middle;align=left;verticalAlign=middle;spacingLeft=6;"
    d.v(TEXT.format(v="middle", s=18, b=1, c="#232F3E"),
        "HomePi 全体像：Raspberry Pi 5 1台 + AWSの4アカウント構成", 20, 10, 900, 32)
    d.v(GRP.format(g="group_corporate_data_center", s="#7D8998", f="#5A6C86", d=0),
        "自宅（オンプレミス）：インターネットに開いたポートなし", 20, 60, 710, 710)
    esp = d.v(BOX.format(a="center", v="middle"),
              "<b>ESP32 x 7</b><br>センサー、LED、電力計測ブリッジ<br>隔離されたIoT Wi-Fi<br>デバイスごとの証明書",
              40, 105, 200, 90)
    gh = d.v(BOX.format(a="center", v="middle"), "<b>GitHub</b>（+ Pi上のbareリポジトリ）<br>homepi-infra<br>"
             "CI（GitHub Actions）", 40, 520, 200, 80)
    lap = d.v(BOX.format(a="center", v="middle"), "<b>ノートPC</b><br>タグの署名鍵、Terraform<br>"
              "（管理はスマートフォンからも）", 40, 640, 200, 70)

    # The Pi and the services inside it
    pic = d.v(PICONT, "Raspberry Pi 5（Ubuntu 24.04、NVMe）", 390, 90, 300, 630)
    mq = d.v(INNER, "Mosquitto（MQTT、mTLS + CRL + ACL）", 405, 125, 270, 40)
    tg = d.v(INNER, "Telegraf → InfluxDB（センサーデータ）", 405, 195, 270, 40)
    obs = d.v(INNER, "Prometheus、Alertmanager、Loki、Grafana", 405, 265, 270, 40)
    ca = d.v(INNER, "step-ca（中間CA）+ 登録API", 405, 325, 270, 40)
    bk = d.v(INNER, "バックアップ（age暗号化）", 405, 380, 270, 40)
    net = d.v(INNER, "nftables（既定拒否）、Unbound（DNSSEC）", 405, 435, 270, 40)
    go = d.v(INNER, "Ansible 33ロール + GitOps（署名付きタグ）", 405, 540, 270, 40)
    acc = d.v(INNER, "nginx + Authelia（2要素認証）、NetBird", 405, 655, 270, 40)

    d.e(esp, mq, "MQTT over mTLS（8883）", extra="exitX=1;exitY=0.44;entryX=0;entryY=0.5;")
    d.e(esp, ca, "起動時に証明書を取得し登録<br>（/step/sign、登録API）", extra="exitX=0.5;exitY=1;entryX=0;entryY=0.5;",
        pts=[(140, 345)])
    d.e(mq, tg, "購読して保存", off=(80, 0))
    d.e(tg, obs, "Grafanaで可視化", off=(85, 0))
    d.e(gh, go, "10分ごとに取得し、署名を<br>確認してAnsibleを適用", extra="exitX=1;exitY=0.5;entryX=0;entryY=0.5;")
    d.e(lap, gh, "署名付きタグ（git push）", off=(0, 0))
    d.e(lap, acc, "管理：NetBird（WireGuard）<br>+ 2要素認証", extra="exitX=1;exitY=0.5;entryX=0;entryY=0.5;")

    # AWS
    d.v(GRP.format(g="group_aws_cloud_alt", s="#232F3E", f="#232F3E", d=0),
        "AWS Organization（4アカウント、東京リージョン、SCP）", 800, 60, 460, 710)
    cw = d.icon(MGT, "cloudwatch_2", "CloudWatch<br>デッドマンスイッチ", 870, 255)
    sns = d.icon(MGT, "sns", "SNS<br>メール通知", 1100, 255)
    ra = d.icon(SEC, "identity_and_access_management", "IAM Roles Anywhere<br>長期アクセスキーなし", 870, 370)
    s3b = d.icon(STO, "s3", "S3 バックアップ<br>Object Lock", 1100, 370)
    la = d.icon(STO, "s3", "log-archive アカウント<br>CloudTrail、Piのログ", 870, 485)
    rep = d.icon(STO, "s3", "backup-vault アカウント<br>バックアップの複製", 1100, 485)
    org = d.v(ICON.format(c=MGT, r="organizations").replace("verticalLabelPosition=bottom;verticalAlign=top;align=center;",
                                                            RIGHT_LABEL),
              "AWS Organizations<br>IAM Identity Center（MFA）", 870, 630, 60, 60, "i")

    d.e(obs, cw, "ハートビート（毎分）", extra="exitX=1;exitY=0.5;entryX=0;entryY=0.5;")
    d.e(cw, sns, "8/10分<br>届かなければ")
    d.e(bk, ra, "X.509証明書で認証<br>（aws_signing_helper）", extra="exitX=1;exitY=0.5;entryX=0;entryY=0.5;")
    d.e(ra, s3b, "暗号化した<br>バックアップ")
    d.e(s3b, rep, "別アカウントへ<br>複製", extra="exitX=1;exitY=0.5;entryX=1;entryY=0.5;", pts=[(1210, 400), (1210, 515)])
    d.e(pic, la, "セキュリティログ<br>（5分ごと）", extra="exitX=1;exitY=0.67;entryX=0;entryY=0.5;",
        pts=[(745, 512), (745, 515)])
    d.e(lap, org, "Terraform（SSO + MFA）", extra="exitX=0.5;exitY=1;entryX=0.5;entryY=1;",
        pts=[(140, 745), (900, 745)])
    return d.xml("homepi-overview", "Overview (Qiita)", 1280, 790)


xml = '<mxfile host="app.diagrams.net">' + full() + overview() + '</mxfile>'
out = sys.argv[1] if len(sys.argv) > 1 else "homepi-target-architecture-v1.drawio"
open(out, "w", encoding="utf-8").write(xml)
print("written: %s (2 pages)" % out)

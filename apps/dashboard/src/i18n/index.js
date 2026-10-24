export const LANGUAGES = { en:'English', fr:'Français', ja:'日本語' }

const T = {
  en: {
    tabs:{ system:'System',security:'Security',sensors:'Sensors',energy:'Energy',floorPlan:'Floor Plan',led:'LED',devices:'Devices',settings:'Settings' },
    system:{ clickHint:'Click a metric to view history', cpu:'CPU Usage', ram:'Memory', disk:'Disk', cpuTemp:'CPU Temp', netIn:'Net ↓', netOut:'Net ↑', uptime:'Uptime' },
    energy:{ electricity:'Electricity',water:'Water',gas:'Gas',period:'Period',consumption:'Consumption',cost:'Cost',savings:'Savings',configContract:'Configure contract',noData:'Connect sensor for real data',estBased:'Estimated from nominal wattage' },
    floor:{ title:'Floor Plan',structure:'Structure',addFloor:'+ Floor',tools:{select:'↖ Select',wall:'▬ Wall',erase:'✕ Erase'},openings:'Openings',elements:'Elements',layers:'Layers',grid:'Grid',snap:'Snap',dim:'Dim',navigate:'🧭 Navigate',edit:'✏️ Edit',fit:'⊡ Fit',doubleTapHint:'Double-tap to draw · Single touch to pan' },
    settings:{ title:'Settings',language:'Language',theme:'Theme',dark:'Dark',light:'Light',auto:'Auto',refreshInterval:'Refresh interval (s)',defaultWindow:'Default time window',apply:'Apply changes',applied:'✓ Applied',dangerZone:'Danger Zone',resetAll:'Reset all data',confirmReset:'This clears all settings and saved plans. Cannot be undone.' },
    common:{ loading:'Loading…',noData:'No data',error:'Error',close:'Close',ok:'OK',cancel:'Cancel',save:'Save',delete:'Delete',edit:'Edit',add:'Add',active:'Active',m:'m',cm:'cm' },
  },
  fr: {
    tabs:{ system:'Système',security:'Sécurité',sensors:'Capteurs',energy:'Énergie',floorPlan:'Plan',led:'LED',devices:'Appareils',settings:'Réglages' },
    system:{ clickHint:'Cliquer pour voir l\'historique', cpu:'CPU', ram:'Mémoire', disk:'Disque', cpuTemp:'Temp CPU', netIn:'Réseau ↓', netOut:'Réseau ↑', uptime:'Uptime' },
    energy:{ electricity:'Électricité',water:'Eau',gas:'Gaz',period:'Période',consumption:'Consommation',cost:'Coût',savings:'Économies',configContract:'Configurer le contrat',noData:'Connecter un capteur',estBased:'Estimé depuis la puissance nominale' },
    floor:{ title:'Plan',structure:'Structure',addFloor:'+ Étage',tools:{select:'↖ Sélect.',wall:'▬ Mur',erase:'✕ Effacer'},openings:'Ouvertures',elements:'Éléments',layers:'Calques',grid:'Grille',snap:'Magnétisme',dim:'Mesures',navigate:'🧭 Navigation',edit:'✏️ Édition',fit:'⊡ Ajuster',doubleTapHint:'Double tap = tracer · Simple tap = naviguer' },
    settings:{ title:'Réglages',language:'Langue',theme:'Thème',dark:'Sombre',light:'Clair',auto:'Auto',refreshInterval:'Rafraîchissement (s)',defaultWindow:'Fenêtre par défaut',apply:'Appliquer',applied:'✓ Appliqué',dangerZone:'Zone dangereuse',resetAll:'Réinitialiser',confirmReset:'Supprime tous les réglages et plans. Irréversible.' },
    common:{ loading:'Chargement…',noData:'Aucune donnée',error:'Erreur',close:'Fermer',ok:'OK',cancel:'Annuler',save:'Sauvegarder',delete:'Supprimer',edit:'Éditer',add:'Ajouter',active:'Actif',m:'m',cm:'cm' },
  },
  ja: {
    tabs:{ system:'システム',security:'セキュリティ',sensors:'センサー',energy:'エネルギー',floorPlan:'間取り',led:'LED',devices:'デバイス',settings:'設定' },
    system:{ clickHint:'クリックで履歴表示', cpu:'CPU使用率', ram:'メモリ', disk:'ディスク', cpuTemp:'CPU温度', netIn:'受信', netOut:'送信', uptime:'稼働時間' },
    energy:{ electricity:'電気',water:'水道',gas:'ガス',period:'期間',consumption:'消費量',cost:'コスト',savings:'節約',configContract:'契約設定',noData:'センサーを接続してください',estBased:'公称消費電力より推定' },
    floor:{ title:'間取り',structure:'構造',addFloor:'+ フロア',tools:{select:'↖ 選択',wall:'▬ 壁',erase:'✕ 削除'},openings:'開口部',elements:'要素',layers:'レイヤー',grid:'グリッド',snap:'スナップ',dim:'寸法',navigate:'🧭 ナビ',edit:'✏️ 編集',fit:'⊡ フィット',doubleTapHint:'ダブルタップで描画 · シングルタップで移動' },
    settings:{ title:'設定',language:'言語',theme:'テーマ',dark:'ダーク',light:'ライト',auto:'自動',refreshInterval:'更新間隔（秒）',defaultWindow:'デフォルト期間',apply:'適用',applied:'✓ 適用済み',dangerZone:'危険ゾーン',resetAll:'全リセット',confirmReset:'全設定とプランを削除します。元に戻せません。' },
    common:{ loading:'読込中…',noData:'データなし',error:'エラー',close:'閉じる',ok:'OK',cancel:'キャンセル',save:'保存',delete:'削除',edit:'編集',add:'追加',active:'有効',m:'m',cm:'cm' },
  },
}

export function getTranslations(lang='en') { return T[lang] || T.en }
export default T
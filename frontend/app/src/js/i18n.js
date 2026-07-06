/* ============================================================================
 * i18n.js — lightweight trilingual UI layer for Geo-Crop Collector
 * Languages: English (en) · Shona (sn) · Ndebele (nd)
 *
 * Plain (non-module) script on purpose: it is included with a normal <script>
 * tag on BOTH the standalone signin.html (inline IIFE, no ES modules) and the
 * main GeoCrop.html app (app.js is an ES module and reads window.t / window.gc*).
 * Load this BEFORE app.js.
 *
 * ⚠️  TRANSLATION STATUS: DRAFT.  The Shona (sn) and Ndebele (nd) strings below
 *     are first-pass drafts and MUST be reviewed/approved by native speakers
 *     (ZINGSA) before production. Entries still equal to the English text are
 *     placeholders awaiting a confirmed local term — search "TODO-nd"/"TODO-sn".
 *     Nothing here changes data stored in the database; this is display only.
 * ==========================================================================*/
(function (w) {
  'use strict';

  var LS_KEY = 'gc_lang';
  var LANGS  = ['en', 'sn', 'nd'];
  var LANG_LABELS = { en: 'English', sn: 'Shona', nd: 'Ndebele' };

  // ── String table. One key → { en, sn, nd }. Kept side-by-side for review. ──
  var S = {
    // ---- Language selector ----
    'lang.label':        { en: 'Language',  sn: 'Mutauro',  nd: 'Ulimi' },

    // ---- Brand / shared ----
    'app.name':          { en: 'Geo-Crop Collector', sn: 'Geo-Crop Collector', nd: 'Geo-Crop Collector' },
    'app.subtitle':      { en: 'Field data collection platform', sn: 'Chishandiso chekuunganidza data reminda', nd: 'Iqonga lokuqoqa idatha yamasimu' },
    'app.platform':      { en: 'ZINGSA Field Data Platform', sn: 'Chishandiso cheData reMunda cheZINGSA', nd: 'Iqonga leZINGSA leDatha yeSimu' },
    'app.reftool':       { en: 'Field Reference Data Tool', sn: 'Chishandiso cheData reReferensi reMunda', nd: 'Ithuluzi leDatha yeSimu' },

    // ---- Sign-in page (signin.html) ----
    'signin.title':      { en: 'Sign in to your account', sn: 'Pinda muakaundi yako', nd: 'Ngena ku-akhawunti yakho' },
    'field.username':    { en: 'Username', sn: 'Zita rekushandisa', nd: 'Ibizo lokusebenzisa' },
    'field.password':    { en: 'Password', sn: 'Password', nd: 'Iphasiwedi' },
    'signin.btn':        { en: 'Sign In', sn: 'Pinda', nd: 'Ngena' },
    'signin.signingin':  { en: 'Signing in…', sn: 'Kupinda…', nd: 'Kuyangena…' },
    'signin.orportal':   { en: 'Or go directly to a portal', sn: 'Kana enda zvakananga kuportal', nd: 'Kumbe uye ngqo kuphothali' },
    'signin.fieldapp':   { en: 'Field Collection App', sn: 'App yeKuunganidza yeMunda', nd: 'I-App yokuQoqa yeSimu' },
    'signin.fieldapp.sub': { en: 'Collectors, validators & viewers', sn: 'Vaunganidzi, vasimbisi & vaoni', nd: 'Abaqoqi, abaqinisi & ababukeli' },
    'signin.newuser':    { en: 'New user?', sn: 'Mushandisi mutsva?', nd: 'Umsebenzisi omutsha?' },
    'signin.register':   { en: 'Register', sn: 'Nyoresa', nd: 'Bhalisa' },
    'signin.download':   { en: 'Download App', sn: 'Dhaunirodha App', nd: 'Landa i-App' },
    'err.entercreds':    { en: 'Please enter your username and password.', sn: 'Ndapota isa zita rekushandisa nepassword.', nd: 'Ngicela ufake ibizo lokusebenzisa lephasiwedi.' },
    'err.loginfailed':   { en: 'Login failed. Please check your credentials.', sn: 'Kupinda kwakundikana. Tarisa zita nepassword.', nd: 'Ukungena kwehlulekile. Hlola ibizo lephasiwedi.' },
    'err.noserver':      { en: 'Cannot reach the server. Please check your internet connection.', sn: 'Hatikwanise kusvika kusevha. Tarisa inzwanet yako.', nd: 'Ayikwazi ukufinyelela isevha. Hlola uxhumano lwakho lwe-inthanethi.' },
    'err.unexpected':    { en: 'An unexpected error occurred. Please try again.', sn: 'Pane chikanganiso chisingatarisirwe. Edzazve.', nd: 'Kube lephutha elingalindelekanga. Zama futhi.' },
    'signin.why':        { en: 'Why use Geo-Crop Collector?', sn: 'Sei uchishandisa Geo-Crop Collector?', nd: 'Kungani usebenzisa i-Geo-Crop Collector?' },
    'signin.tagline':    { en: "Zimbabwe's national platform for precision agricultural field data.", sn: 'Chishandiso chenyika cheZimbabwe cheruzivo rwuzere rwedata reminda.', nd: 'Iqonga likazwelonke leZimbabwe ledatha enembileyo yamasimu.' },
    'feat.gps':          { en: 'GPS Field Mapping', sn: 'Kuratidza Minda neGPS', nd: 'Ukudweba amaSimu nge-GPS' },
    'feat.gps.sub':      { en: 'Draw field boundaries, drop point markers, capture GPS coordinates', sn: 'Dhirowa miganhu yeminda, isa mamaka, tora ma-GPS coordinates', nd: 'Dweba imingcele yamasimu, faka amamakha, thatha ama-GPS coordinates' },
    'feat.offline':      { en: 'Offline-Capable', sn: 'Inoshanda Isina Inzwanet', nd: 'Iyasebenza ingekho ku-inthanethi' },
    'feat.offline.sub':  { en: 'Collect data in remote areas without internet', sn: 'Unganidza data kunzvimbo dziri kure pasina inzwanet', nd: 'Qoqa idatha ezindaweni ezikude ngaphandle kwe-inthanethi' },
    'feat.crop':         { en: 'Crop Type Tracking', sn: 'Kuronda Marudzi eZvirimwa', nd: 'Ukulandelela iziNhlobo zeziLimo' },
    'feat.crop.sub':     { en: 'Record 20+ crop types with growth stage, irrigation, and field condition data', sn: 'Nyora marudzi anopfuura 20 nedanho rekukura, nediro, nemamiriro emunda', nd: 'Bhala izinhlobo ezingaphezu kuka-20 lesigaba sokukhula, ukunisela, lesimo sesimu' },
    'feat.role':         { en: 'Multi-Role Workflow', sn: 'Mabasa Akasiyana', nd: 'Imisebenzi eminengi' },
    'feat.role.sub':     { en: 'Collectors, validators, viewers — all managed in one system', sn: 'Vaunganidzi, vasimbisi, vaoni — vese vachitariswa musystem imwe', nd: 'Abaqoqi, abaqinisi, ababukeli — bonke kusistimu eyodwa' },
    'feat.mobile':       { en: 'Native Mobile App', sn: 'App yeFoni', nd: 'I-App yeFoni' },
    'feat.mobile.sub':   { en: 'Download for Android (APK) or iOS (IPA) for a full offline-first field collection experience', sn: 'Dhaunirodha yeAndroid (APK) kana iOS (IPA) kuti uwane ruzivo rwakazara rwekuunganidza', nd: 'Landela i-Android (APK) kumbe i-iOS (IPA) ukuze uthole okugcweleyo kokuqoqa' },
    'org.full':          { en: 'Zimbabwe National Geospatial and Space Agency', sn: 'Zimbabwe National Geospatial and Space Agency', nd: 'Zimbabwe National Geospatial and Space Agency' },

    // ---- Login gate / auth (GeoCrop.html) ----
    'gate.noaccount':    { en: "Don't have an account?", sn: 'Hauna akaundi?', nd: 'Awula i-akhawunti?' },
    'unlock.title':      { en: 'Unlock app', sn: 'Vhura app', nd: 'Vula i-app' },
    'unlock.sub':        { en: 'Enter your device PIN to use your saved session', sn: 'Isa PIN yedivhaisi kuti ushandise session yako', nd: 'Faka i-PIN yedivayisi ukuze usebenzise isikhathi sakho' },
    'unlock.pin':        { en: '6-digit PIN', sn: 'PIN yenhamba 6', nd: 'I-PIN yezinombolo eziyisi-6' },
    'unlock.btn':        { en: 'Unlock', sn: 'Vhura', nd: 'Vula' },
    'pin.protect':       { en: 'Protect this device?', sn: 'Dzivirira divhaisi iyi?', nd: 'Vikela le-divayisi?' },
    'pin.protect.sub':   { en: 'Set a PIN so only you can open the app when your session is saved offline.', sn: 'Isa PIN kuti iwe chete ukwanise kuvhura app kana session yakachengetwa.', nd: 'Beka i-PIN ukuze nguwe wedwa ovula i-app nxa isikhathi sakho sigciniwe.' },
    'pin.confirm':       { en: 'Confirm 6-digit PIN', sn: 'Simbisa PIN yenhamba 6', nd: 'Qinisa i-PIN yezinombolo eziyisi-6' },
    'pin.enable':        { en: 'Enable app lock', sn: 'Batidza kukiya kwe-app', nd: 'Vula ukukhiya kwe-app' },
    'pin.notnow':        { en: 'Not now', sn: 'Kwete zvino', nd: 'Hatshi khathesi' },
    'auth.account':      { en: 'Account', sn: 'Akaundi', nd: 'I-akhawunti' },
    'auth.login':        { en: 'Login', sn: 'Pinda', nd: 'Ngena' },
    'auth.register':     { en: 'Register', sn: 'Nyoresa', nd: 'Bhalisa' },
    'auth.email':        { en: 'Email', sn: 'Email', nd: 'I-imeyili' },
    'auth.password8':    { en: 'Password (min 8 chars)', sn: 'Password (mavara 8+)', nd: 'Iphasiwedi (okungenani oku-8)' },
    'auth.confirmpw':    { en: 'Confirm Password', sn: 'Simbisa Password', nd: 'Qinisa Iphasiwedi' },
    'auth.org':          { en: 'Organisation (optional)', sn: 'Sangano (kusarudza)', nd: 'Inhlangano (ongakhetha)' },
    'auth.create':       { en: 'Create Account', sn: 'Gadzira Akaundi', nd: 'Yenza i-akhawunti' },
    'auth.submitted':    { en: 'Registration Submitted', sn: 'Kunyoresa Kwatumirwa', nd: 'Ukubhalisa Kuthunyelwe' },
    'auth.pending':      { en: 'Your account is pending admin approval. You will receive an email once your account has been approved.', sn: 'Akaundi yako yakamirira kutenderwa nemutariri. Uchawana email kana yatenderwa.', nd: 'I-akhawunti yakho ilindele ukuvunyelwa ngumphathi. Uzathola i-imeyili nxa isivunyelwe.' },
    'auth.backlogin':    { en: 'Back to Login', sn: 'Dzokera kuPinda', nd: 'Buyela ekuNgeneni' },
    'role.collector':    { en: 'Collector', sn: 'Muunganidzi', nd: 'Umqoqi' },
    'role.validator':    { en: 'Validator', sn: 'Musimbisi', nd: 'Umqinisi' },
    'role.viewer':       { en: 'Viewer', sn: 'Muoni', nd: 'Umbukeli' },
    'role.admin':        { en: 'Admin', sn: 'Mutariri', nd: 'Umphathi' },
    'auth.loggedin':     { en: "You're logged in and can upload MBTiles, sync data, and validate entries.", sn: 'Wapinda uye unogona kuisa MBTiles, kuchenesa data, nekusimbisa zvakanyorwa.', nd: 'Usungenile futhi ungalayisha i-MBTiles, uvumelanise idatha, uqinise okufakiweyo.' },
    'auth.applock':      { en: 'App lock (this device)', sn: 'Kukiya kwe-app (divhaisi iyi)', nd: 'Ukukhiya kwe-app (le-divayisi)' },
    'auth.applock.on':   { en: 'App lock is enabled.', sn: 'Kukiya kwe-app kwabatidzwa.', nd: 'Ukukhiya kwe-app kuvuliwe.' },
    'auth.applock.disable': { en: 'Disable app lock', sn: 'Dzima kukiya kwe-app', nd: 'Vala ukukhiya kwe-app' },
    'auth.logout':       { en: 'Logout', sn: 'Buda', nd: 'Phuma' },
    'pin.confirmshort':  { en: 'Confirm PIN', sn: 'Simbisa PIN', nd: 'Qinisa i-PIN' },
    'survey.newname':    { en: 'New survey name', sn: 'Zita reongororo itsva', nd: 'Ibizo lehlolo elitsha' },
    'survey.create':     { en: '+ Create', sn: '+ Gadzira', nd: '+ Yenza' },
    'bar.newversion':    { en: 'New version available', sn: 'Vhezheni itsva iripo', nd: 'Kukhona inguqulo entsha' },
    'map.drawhint':      { en: '👆🏻 Use the toolbar to draw a polygon or place a marker on the map', sn: '👆🏻 Shandisa toolbar kudhirowa polygon kana kuisa maka pamepu', nd: '👆🏻 Sebenzisa i-toolbar ukudweba i-polygon kumbe ufake imakha emephini' },
    'chip.entries':      { en: 'entries', sn: 'zvakanyorwa', nd: 'okufakiweyo' },
    'chip.validated':    { en: 'validated', sn: 'zvasimbiswa', nd: 'okuqinisiweyo' },
    'collect.drawnotice': { en: 'Use the map toolbar to <strong>draw a polygon</strong> around a field or <strong>drop a marker</strong>, then complete the form below and save.', sn: 'Shandisa toolbar yemepu ku<strong>dhirowa polygon</strong> kutenderedza munda kana <strong>kuisa maka</strong>, wozadzisa fomu uchengetedze.', nd: 'Sebenzisa i-toolbar yemephu uku<strong>dweba i-polygon</strong> ozungeze isimu kumbe u<strong>fake imakha</strong>, ubusugcwalisa ifomu ugcine.' },
    'validate.hint':     { en: 'Click <strong>Validate</strong> mode in the header, then <strong>click any field</strong> on the map to select it for review.', sn: 'Dzvanya <strong>Simbisa</strong> pamusoro, wozodzvanya <strong>munda chero upi</strong> pamepu kuti uusarudze.', nd: 'Chofoza i-<strong>Qinisa</strong> enhloko, ube usuchofoza <strong>lisiphi isimu</strong> emephini ukuze usikhethe.' },
    'validate.pctsuffix': { en: ' validated', sn: ' zvasimbiswa', nd: ' okuqinisiweyo' },
    'upload.nolocalmbt': { en: 'No local MBTiles imported yet.', sn: 'Hapana MBTiles yakapinzwa padivhaisi.', nd: 'Awukho ama-MBTiles angeniswe kudivayisi.' },
    'upload.nolocalov':  { en: 'No local overlays imported yet.', sn: 'Hapana ma-overlay akapinzwa padivhaisi.', nd: 'Awakho ama-overlay angeniswe kudivayisi.' },
    'upload.mbt.admindesc': { en: 'Upload a <code>.mbtiles</code> file to the server (visible to all users).', sn: 'Isa faira re<code>.mbtiles</code> kusevha (rinoonekwa nevashandisi vese).', nd: 'Layisha ifayela le<code>.mbtiles</code> esevheni (libonwa ngabo bonke abasebenzisi).' },
    'upload.mbt.localdesc': { en: 'Import a <code>.mbtiles</code> file to your device for offline use.', sn: 'Pinza faira re<code>.mbtiles</code> mudivhaisi yako kuti ushandise usina inzwanet.', nd: 'Ngenisa ifayela le<code>.mbtiles</code> kudivayisi yakho ukuze usebenzise ungekho ku-inthanethi.' },
    'upload.ov.admindesc': { en: 'Upload <code>.geojson</code>, <code>.gpkg</code>, or <code>.kml</code> to the server (visible to all users).', sn: 'Isa <code>.geojson</code>, <code>.gpkg</code>, kana <code>.kml</code> kusevha (zvinoonekwa nevese).', nd: 'Layisha <code>.geojson</code>, <code>.gpkg</code>, kumbe <code>.kml</code> esevheni (kubonwa ngabo bonke).' },
    'upload.ov.localdesc': { en: 'Import <code>.geojson</code>, <code>.kml</code>, or <code>.gpkg</code> overlay files to your device.', sn: 'Pinza mafaira e-overlay e<code>.geojson</code>, <code>.kml</code>, kana <code>.gpkg</code> mudivhaisi yako.', nd: 'Ngenisa amafayela e-overlay e<code>.geojson</code>, <code>.kml</code>, kumbe <code>.gpkg</code> kudivayisi yakho.' },

    // ---- Header pills ----
    'nav.collect':       { en: 'Collect', sn: 'Unganidza', nd: 'Qoqa' },
    'nav.validate':      { en: 'Validate', sn: 'Simbisa', nd: 'Qinisa' },
    'nav.online':        { en: 'Online', sn: 'Pa-inzwanet', nd: 'Ku-inthanethi' },
    'nav.offline':       { en: 'Offline', sn: 'Isina inzwanet', nd: 'Ngaphandle kwe-inthanethi' },
    'nav.theme':         { en: 'Theme', sn: 'Ruvara', nd: 'Umbala' },
    'nav.surveys':       { en: 'Surveys', sn: 'Ongororo', nd: 'Izinhlolo' },
    'nav.compass':       { en: 'Compass', sn: 'Kambasi', nd: 'Ikhampasi' },
    'nav.app':           { en: 'App', sn: 'App', nd: 'I-App' },

    // ---- Sidebar tabs ----
    'tab.collect':       { en: 'Collect', sn: 'Unganidza', nd: 'Qoqa' },
    'tab.validate':      { en: 'Validate', sn: 'Simbisa', nd: 'Qinisa' },
    'tab.entries':       { en: 'Entries', sn: 'Zvakanyorwa', nd: 'Okufakiweyo' },
    'tab.upload':        { en: 'Upload', sn: 'Isa', nd: 'Layisha' },
    'tab.sent':          { en: 'Sent', sn: 'Zvatumirwa', nd: 'Okuthunyelweyo' },

    // ---- Collect panel ----
    'stat.total':        { en: 'Total', sn: 'Zvese', nd: 'Isamba' },
    'stat.validated':    { en: 'Validated', sn: 'Zvasimbiswa', nd: 'Okuqinisiweyo' },
    'stat.fields':       { en: 'Fields', sn: 'Minda', nd: 'Amasimu' },
    'collect.details':   { en: 'Field Details', sn: 'Ruzivo rweMunda', nd: 'Imininingwane yeSimu' },
    'collect.survey':    { en: 'Survey *', sn: 'Ongororo *', nd: 'Ihlolo *' },
    'collect.sector':    { en: 'Sector *', sn: 'Chikamu *', nd: 'Isigaba *' },
    'collect.sector.other': { en: 'Specify sector', sn: 'Tsanangura chikamu', nd: 'Chaza isigaba' },
    'collect.croptypes': { en: 'Crop Type(s) *', sn: 'Marudzi eZvirimwa *', nd: 'Izinhlobo zeziLimo *' },
    'collect.selectcrops': { en: 'Select crops…', sn: 'Sarudza zvirimwa…', nd: 'Khetha izilimo…' },
    'collect.startcapture': { en: 'Start Capture', sn: 'Tanga Kutora', nd: 'Qalisa Ukuthatha' },
    'collect.nogeom':    { en: 'No geometry — draw on map or use buttons below', sn: 'Hapana geometry — dhirowa pamepu kana shandisa mabhatani ari pasi', nd: 'Ayikho i-geometry — dweba emephini kumbe usebenzise amabhathini angezansi' },
    'collect.drawpoly':  { en: 'Draw Polygon', sn: 'Dhirowa Polygon', nd: 'Dweba i-Polygon' },
    'collect.capturepoint': { en: 'Capture Point', sn: 'Tora Poindi', nd: 'Thatha i-Point' },
    'collect.season':    { en: 'Season', sn: 'Mwaka', nd: 'Isikhathi sonyaka' },
    'collect.plantdate': { en: 'Planting Date', sn: 'Zuva reKudyara', nd: 'Usuku lokuhlanyela' },
    'collect.harvestdate': { en: 'Harvest Date', sn: 'Zuva reKukohwa', nd: 'Usuku lokuvuna' },
    'collect.growth':    { en: 'Growth Stage', sn: 'Danho reKukura', nd: 'Isigaba sokuKhula' },
    'collect.condition': { en: 'Crop Condition', sn: 'Mamiriro eChirimwa', nd: 'Isimo seSilimo' },
    'collect.irrigation': { en: 'Irrigation', sn: 'Diro', nd: 'Ukunisela' },
    'collect.notes':     { en: 'Observation Notes', sn: 'Zvakacherechedzwa', nd: 'Amanothi okubonayo' },
    'collect.area':      { en: 'Area (Ha)', sn: 'Nzvimbo (Ha)', nd: 'Ubukhulu (Ha)' },
    'collect.seed':      { en: 'Seed Used (kg)', sn: 'Mbeu Yashandiswa (kg)', nd: 'Inhlanyelo Esetshenzisiwe (kg)' },
    'collect.fert':      { en: 'Fertiliser Used (kg)', sn: 'Fetereza Yashandiswa (kg)', nd: 'Umvundiso Osetshenzisiwe (kg)' },
    'collect.yield':     { en: 'Expected Yield (tonnes/ha)', sn: 'Goho Rinotarisirwa (matani/ha)', nd: 'Isivuno Esilindelweyo (amathani/ha)' },
    'collect.prevyield': { en: 'Previous Year Yield (tonnes/ha)', sn: 'Goho reGore Rapfuura (matani/ha)', nd: 'Isivuno soNyaka Odlulileyo (amathani/ha)' },
    'collect.photos':    { en: 'Attach field photos (optional)', sn: 'Batanidza mifananidzo yemunda (kusarudza)', nd: 'Namathisela izithombe zesimu (ongakhetha)' },
    'collect.save':      { en: 'Save Entry', sn: 'Chengetedza', nd: 'Gcina okufakiweyo' },
    'collect.legend':    { en: 'Map Legend', sn: 'Tsananguro yeMepu', nd: 'Incazelo yeMephu' },
    'collect.nocrops':   { en: 'No crops mapped yet.', sn: 'Hapana zvirimwa zvakaiswa pamepu.', nd: 'Azikho izilimo ezisemephini.' },

    // ---- Validate panel ----
    'validate.form':     { en: 'Validation Form', sn: 'Fomu reKusimbisa', nd: 'Ifomu lokuQinisa' },
    'validate.selected': { en: 'Selected:', sn: 'Zvasarudzwa:', nd: 'Okukhethiweyo:' },
    'validate.status':   { en: 'Validation Status *', sn: 'Mamiriro eKusimbisa *', nd: 'Isimo sokuQinisa *' },
    'validate.confidence': { en: 'Confidence Level *', sn: 'Chivimbo *', nd: 'Izinga lokuqiniseka *' },
    'validate.note':     { en: 'Validator Note', sn: 'Cherechedzo yeMusimbisi', nd: 'Inothi loMqinisi' },
    'validate.evidence': { en: 'Evidence photos', sn: 'Mifananidzo yeuchapupu', nd: 'Izithombe zobufakazi' },
    'validate.submit':   { en: 'Submit Validation', sn: 'Tumira Kusimbisa', nd: 'Thumela ukuQinisa' },
    'validate.stats':    { en: 'Validation Stats', sn: 'Nhamba dzeKusimbisa', nd: 'Izibalo zokuQinisa' },
    'validate.pct':      { en: '% validated', sn: '% zvasimbiswa', nd: '% okuqinisiweyo' },

    // ---- Entries panel ----
    'entries.search':    { en: 'Search entries…', sn: 'Tsvaga zvakanyorwa…', nd: 'Sesha okufakiweyo…' },
    'entries.allcrops':  { en: 'All crops', sn: 'Zvirimwa zvese', nd: 'Zonke izilimo' },
    'entries.filtercrop': { en: 'Filter by crop', sn: 'Sefa nechirimwa', nd: 'Hlela ngesilimo' },

    // ---- Upload panel ----
    'upload.mbtiles':    { en: 'MBTiles Map Layers', sn: 'MBTiles Map Layers', nd: 'MBTiles Map Layers' },
    'upload.layername':  { en: 'Layer name', sn: 'Zita reLayer', nd: 'Ibizo le-Layer' },
    'upload.choosembt':  { en: 'Choose .mbtiles file…', sn: 'Sarudza faira re-.mbtiles…', nd: 'Khetha ifayela le-.mbtiles…' },
    'upload.toserver':   { en: 'Upload to Server', sn: 'Isa kuSevha', nd: 'Layisha kuSevha' },
    'upload.todevice':   { en: 'Import to Device', sn: 'Pinza muDivhaisi', nd: 'Ngenisa kuDivayisi' },
    'upload.mylocal':    { en: 'My Local Layers', sn: 'Ma-Layer angu', nd: 'Ama-Layer ami' },
    'upload.serverlayers': { en: 'Server Layers', sn: 'Ma-Layer eSevha', nd: 'Ama-Layer eSevha' },
    'upload.overlays':   { en: 'Route Overlays', sn: 'Route Overlays', nd: 'Route Overlays' },
    'upload.serveroverlays': { en: 'Server Overlays', sn: 'Ma-Overlay eSevha', nd: 'Ama-Overlay eSevha' },
    'upload.myoverlays': { en: 'My Local Overlays', sn: 'Ma-Overlay angu', nd: 'Ama-Overlay ami' },
    'upload.chooseoverlay': { en: 'Choose overlay file…', sn: 'Sarudza faira reoverlay…', nd: 'Khetha ifayela le-overlay…' },
    'upload.danger':     { en: 'Danger Zone', sn: 'Nzvimbo yeNgozi', nd: 'Indawo yeNgozi' },
    'upload.clearall':   { en: 'Clear All Data', sn: 'Bvisa Data Rese', nd: 'Sula Yonke Idatha' },
    'common.loading':    { en: 'Loading…', sn: 'Kutakura…', nd: 'Kuyalayisha…' },

    // ---- Sent panel ----
    'sent.send':         { en: 'Send to Server', sn: 'Tumira kuSevha', nd: 'Thumela kuSevha' },
    'sent.pushdesc':     { en: 'Push all locally saved entries to server.', sn: 'Tumira zvese zvakachengetwa padivhaisi kuenda kusevha.', nd: 'Thumela konke okugciniweyo edivayisini kuya esevheni.' },
    'sent.export':       { en: 'Export Data', sn: 'Buritsa Data', nd: 'Khipha Idatha' },
    'sent.exportdesc':   { en: 'Export your field data in your preferred format.', sn: 'Buritsa data remunda nechimiro chaunoda.', nd: 'Khipha idatha yesimu ngendlela oyifunayo.' },
    'sent.format':       { en: 'Format', sn: 'Chimiro', nd: 'Ifomethi' },
    'sent.summary':      { en: 'Summary', sn: 'Pfupiso', nd: 'Isifinyezo' },

    // ---- Map / misc ----
    'map.showpanel':     { en: 'Show Panel', sn: 'Ratidza Panel', nd: 'Bonisa i-Panel' },
    'map.showmap':       { en: 'Show Map', sn: 'Ratidza Mepu', nd: 'Bonisa iMephu' },
    'entries.unvalidated': { en: 'Unvalidated', sn: 'Hazvina kusimbiswa', nd: 'Akuqiniswanga' },
    'bar.offline':       { en: 'Offline — data is saved locally', sn: 'Isina inzwanet — data rakachengetwa padivhaisi', nd: 'Ngaphandle kwe-inthanethi — idatha igciniwe edivayisini' },
    'bar.offlineauth':   { en: 'Offline session — data saved locally, will sync when online', sn: 'Session isina inzwanet — data rakachengetwa, richasync kana pane inzwanet', nd: 'Isikhathi ngaphandle kwe-inthanethi — idatha igciniwe, izavumelaniswa nxa uku-inthanethi' },
    'bar.updatenow':     { en: 'Update now', sn: 'Gadziridza zvino', nd: 'Buyekeza khathesi' },

    // ---- Sectors ----
    'sector.lscfa':      { en: 'LSCFA', sn: 'LSCFA', nd: 'LSCFA' },
    'sector.a2':         { en: 'A2', sn: 'A2', nd: 'A2' },
    'sector.a1':         { en: 'A1', sn: 'A1', nd: 'A1' },
    'sector.sscfa':      { en: 'SSCFA', sn: 'SSCFA', nd: 'SSCFA' },
    'sector.or':         { en: 'OR', sn: 'OR', nd: 'OR' },
    'sector.ca':         { en: 'CA', sn: 'CA', nd: 'CA' },
    'sector.peri_urban': { en: 'Peri urban', sn: 'Pedyo neguta', nd: 'Eduze ledolobha' },
    'sector.other':      { en: 'Other', sn: 'Zvimwe', nd: 'Okunye' },

    // ---- Season ----
    'season.main':       { en: 'Main Season', sn: 'Mwaka Mukuru', nd: 'Isikhathi Esikhulu' },
    'season.secondary':  { en: 'Secondary Season', sn: 'Mwaka Wechipiri', nd: 'Isikhathi Sesibili' },
    'season.irrigated':  { en: 'Irrigated (Off-season)', sn: 'Yediro (Kunze kwemwaka)', nd: 'Enisiweyo (Ngaphandle kwesikhathi)' },

    // ---- Growth stage ----
    'growth.emergence':        { en: 'Emergence', sn: 'Kumera', nd: 'Ukuqhamuka' },
    'growth.early_vegetative': { en: 'Early Vegetative', sn: 'Kukura Kwekutanga', nd: 'Ukukhula Kwakuqala' },
    'growth.late_vegetative':  { en: 'Late Vegetative', sn: 'Kukura Kwekupedzisira', nd: 'Ukukhula Kwamuva' },
    'growth.early_productive':  { en: 'Early Productive', sn: 'Kubereka Kwekutanga', nd: 'Ukuthela Kwakuqala' },
    'growth.late_reproductive': { en: 'Late Reproductive', sn: 'Kubereka Kwekupedzisira', nd: 'Ukuthela Kwamuva' },
    'growth.maturity':         { en: 'Maturity', sn: 'Kuibva', nd: 'Ukuvuthwa' },
    'growth.senescence':       { en: 'Senescence', sn: 'Kuoma', nd: 'Ukubuna' },
    'growth.harvested':        { en: 'Harvested', sn: 'Zvakohwewa', nd: 'Okuvuniweyo' },

    // ---- Crop condition ----
    'cond.permanent_wilting':  { en: 'Permanent Wilting', sn: 'Kusvava Kwenguva Yose', nd: 'Ukubuna Okungapheliyo' },
    'cond.temporary_wilting':  { en: 'Temporary Wilting', sn: 'Kusvava Kwenguva Duku', nd: 'Ukubuna Kwesikhashana' },
    'cond.poor':               { en: 'Poor', sn: 'Zvakaipa', nd: 'Okubi' },
    'cond.fair':               { en: 'Fair', sn: 'Zvirimuenzaniso', nd: 'Okulingene' },
    'cond.good':               { en: 'Good', sn: 'Zvakanaka', nd: 'Okuhle' },
    'cond.leached_waterlogged': { en: 'Leached/Waterlogged', sn: 'Kukukurwa/Kuzara Mvura', nd: 'Kugezekile/Kugcwele Amanzi' },

    // ---- Irrigation ----
    'irr.rainfed':       { en: 'Rainfed', sn: 'Yemvura', nd: 'Yezulu' },
    'irr.irrigated':     { en: 'Irrigated', sn: 'Yediro', nd: 'Enisiweyo' },
    'irr.unknown':       { en: 'Unknown', sn: 'Hazvizivikanwe', nd: 'Akwaziwa' },

    // ---- Validation status / confidence ----
    'vstatus.correct':   { en: 'Correct', sn: 'Zvakanaka', nd: 'Okulungileyo' },
    'vstatus.incorrect': { en: 'Incorrect', sn: 'Zvisirizvo', nd: 'Okungalunganga' },
    'vstatus.uncertain': { en: 'Uncertain', sn: 'Hazvina Chokwadi', nd: 'Okungaqinisekanga' },
    'conf.5':            { en: 'Very Sure', sn: 'Ndine Chokwadi Chikuru', nd: 'Ngiqiniseka Kakhulu' },
    'conf.4':            { en: 'Sure', sn: 'Ndine Chokwadi', nd: 'Ngiqinisekile' },
    'conf.3':            { en: 'Moderate', sn: 'Zvepakati', nd: 'Okuphakathi' },
    'conf.2':            { en: 'Uncertain', sn: 'Hazvina Chokwadi', nd: 'Angiqiniseki' },
    'conf.1':            { en: 'Very Uncertain', sn: 'Hazvina Chokwadi Zvachose', nd: 'Angiqiniseki Lakancane' },
    'vstat.correct':     { en: 'Correct', sn: 'Zvakanaka', nd: 'Okulungileyo' },
    'vstat.incorrect':   { en: 'Incorrect', sn: 'Zvisirizvo', nd: 'Okungalunganga' },
    'vstat.uncertain':   { en: 'Uncertain', sn: 'Hazvina Chokwadi', nd: 'Okungaqinisekanga' },

    // ---- Crop names (display only; DB keeps English keys) ----
    // NOTE: sn/nd crop names are DRAFT — confirm with agronomy/native reviewers.
    'crop.maize':        { en: 'Maize', sn: 'Chibage', nd: 'Umumbu' },
    'crop.tobacco':      { en: 'Tobacco', sn: 'Fodya', nd: 'Ugwayi' },
    'crop.sesame':       { en: 'Sesame', sn: 'Runinga', nd: 'Uduna' },
    'crop.sorghum':      { en: 'Sorghum', sn: 'Mapfunde', nd: 'Amabele' },
    'crop.cotton':       { en: 'Cotton', sn: 'Donje', nd: 'Udonga' },
    'crop.pearl_millet': { en: 'Pearl Millet', sn: 'Mhunga', nd: 'Inyawuthi' },
    'crop.groundnut':    { en: 'Groundnut', sn: 'Nzungu', nd: 'Amazambane esihlanga' },
    'crop.soyabean':     { en: 'Soyabean', sn: 'Soya', nd: 'Isoya' },
    'crop.finger_millet': { en: 'Finger Millet', sn: 'Rukweza', nd: 'Uphoko' },
    'crop.potato':       { en: 'Potato', sn: 'Mbatatisi', nd: 'Amazambane' },
    'crop.sunflower':    { en: 'Sunflower', sn: 'Sunflower', nd: 'Uluba lwelanga' },
    'crop.tea':          { en: 'Tea', sn: 'Tea', nd: 'Itiye' },
    'crop.pepper':       { en: 'Pepper', sn: 'Mhiripiri', nd: 'Upelepele' },
    'crop.roundnut':     { en: 'Roundnut', sn: 'Nyimo', nd: 'Indlubu' },
    'crop.sugarcane':    { en: 'Sugarcane', sn: 'Ipwa', nd: 'Umoba' },
    'crop.cabbage':      { en: 'Cabbage', sn: 'Kabichi', nd: 'Ikhabishi' },
    'crop.banana':       { en: 'Banana', sn: 'Bhanana', nd: 'Ubhanana' },
    'crop.tomato':       { en: 'Tomato', sn: 'Domasi', nd: 'Utamatisi' },
    'crop.sugarbean':    { en: 'Sugarbean', sn: 'Bhinzi', nd: 'Indumba' },
    'crop.macademia':    { en: 'Macademia', sn: 'Macademia', nd: 'Umakhadamiya' },
    'crop.bambaranuts':  { en: 'Bambaranuts', sn: 'Nyimo', nd: 'Indlubu' },
    'crop.cowpea':       { en: 'African Pea/Cowpea', sn: 'Nyemba', nd: 'Indumba yesiNtu' },
    'crop.paprika':      { en: 'Paprika', sn: 'Paprika', nd: 'Ipaprika' },
    'crop.rice':         { en: 'Rice', sn: 'Mupunga', nd: 'Ilayisi' },
    'crop.cassava':      { en: 'Cassava', sn: 'Mufarinya', nd: 'Umdumbula' },
    'crop.chick_pea':    { en: 'Chick Pea', sn: 'Chickpea', nd: 'Ichickpea' },
    'crop.pigeon_pea':   { en: 'Pigeon Pea', sn: 'Nyemba dzeshiri', nd: 'Idumba lenkukhu' },
    'crop.summer_wheat': { en: 'Summer Wheat', sn: 'Gorosi rezhizha', nd: 'Ingqoloyi yehlobo' },
    'crop.caster_beans': { en: 'Caster Beans', sn: 'Mupfuta', nd: 'Umhlakuva' },
    'crop.cocoyam':      { en: 'Cocoyam', sn: 'Madhumbe', nd: 'Amadumbe' },
    'crop.tsenza':       { en: 'Tsenza', sn: 'Tsenza', nd: 'Itsenza' },
    'crop.wheat':        { en: 'Wheat', sn: 'Gorosi', nd: 'Ingqoloyi' },
    'crop.barley':       { en: 'Barley', sn: 'Bhari', nd: 'Ibhali' },
    'crop.pea':          { en: 'Pea', sn: 'Pizi', nd: 'Uphizi' },
    'crop.other':        { en: 'Other crop', sn: 'Chimwe chirimwa', nd: 'Esinye isilimo' }
  };

  // ── Core ────────────────────────────────────────────────────────────────
  function getLang() {
    var l = w.localStorage.getItem(LS_KEY);
    return LANGS.indexOf(l) >= 0 ? l : 'en';
  }

  function t(key, fallback) {
    var row = S[key];
    if (!row) return (fallback != null ? fallback : key);
    var lang = getLang();
    return row[lang] || row.en || (fallback != null ? fallback : key);
  }

  // Crop display label from a DB crop key (e.g. "maize" → localized).
  function crop(key) { return t('crop.' + key, cap(String(key || '').replace(/_/g, ' '))); }
  // Generic enum label: gcEnum('season','main'), gcEnum('growth','maturity'), etc.
  function gcEnum(group, key) {
    var map = { sector: 'sector', season: 'season', growth: 'growth',
                condition: 'cond', irrigation: 'irr', vstatus: 'vstat' };
    var prefix = map[group] || group;
    return t(prefix + '.' + key, cap(String(key || '').replace(/_/g, ' ')));
  }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  // Apply translations to a DOM subtree via data-i18n* attributes.
  function applyI18n(root) {
    root = root || w.document;
    var el, i, list;

    list = root.querySelectorAll('[data-i18n]');
    for (i = 0; i < list.length; i++) {
      el = list[i];
      // data-i18n-prefix lets <option> elements (which cannot hold child nodes)
      // keep a language-neutral emoji/star prefix in front of the translation.
      var pfx = el.getAttribute('data-i18n-prefix');
      el.textContent = (pfx ? pfx : '') + t(el.getAttribute('data-i18n'));
    }

    list = root.querySelectorAll('[data-i18n-html]');
    for (i = 0; i < list.length; i++) { el = list[i]; el.innerHTML = t(el.getAttribute('data-i18n-html')); }

    list = root.querySelectorAll('[data-i18n-ph]');
    for (i = 0; i < list.length; i++) { el = list[i]; el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); }

    list = root.querySelectorAll('[data-i18n-title]');
    for (i = 0; i < list.length; i++) { el = list[i]; el.setAttribute('title', t(el.getAttribute('data-i18n-title'))); }

    list = root.querySelectorAll('[data-i18n-aria]');
    for (i = 0; i < list.length; i++) { el = list[i]; el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); }

    if (root === w.document || root === w.document.documentElement) {
      try { w.document.documentElement.setAttribute('lang', getLang()); } catch (e) {}
    }
  }

  function setLang(lang) {
    if (LANGS.indexOf(lang) < 0) lang = 'en';
    w.localStorage.setItem(LS_KEY, lang);
    applyI18n(w.document);
    try { w.dispatchEvent(new CustomEvent('gc:langchange', { detail: { lang: lang } })); } catch (e) {}
  }

  // Build a <select> language switcher inside `container`.
  function mountLangSelect(container, opts) {
    if (!container) return;
    opts = opts || {};
    var sel = w.document.createElement('select');
    sel.className = opts.className || 'gc-lang-select';
    if (opts.id) sel.id = opts.id;
    for (var i = 0; i < LANGS.length; i++) {
      var o = w.document.createElement('option');
      o.value = LANGS[i]; o.textContent = LANG_LABELS[LANGS[i]];
      if (LANGS[i] === getLang()) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', function () { setLang(sel.value); });
    container.appendChild(sel);
    return sel;
  }

  // Auto-apply once the DOM is ready.
  if (w.document.readyState === 'loading') {
    w.document.addEventListener('DOMContentLoaded', function () { applyI18n(w.document); });
  } else {
    applyI18n(w.document);
  }

  // Public surface (usable from both the IIFE page scripts and ES-module app.js).
  w.t             = t;
  w.gcT           = t;
  w.gcCrop        = crop;
  w.gcEnum        = gcEnum;
  w.gcGetLang     = getLang;
  w.gcSetLang     = setLang;
  w.gcApplyI18n   = applyI18n;
  w.gcMountLangSelect = mountLangSelect;
  w.GC_LANGS      = LANGS;
  w.GC_LANG_LABELS = LANG_LABELS;
})(window);

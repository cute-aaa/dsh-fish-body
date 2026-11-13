/**
 * 设置页法语文案；键集与 zh 完全一致。
 */
import type { Key } from './zh.ts';

export const fr: Record<Key, string> = {
  nav: 'Configuration des compagnons',
  tabLook: 'Apparence',
  petCardTitle: 'Compagnon',
  avatarLabel: 'Avatar',
  avatarHint:
    'La petite image affichée à côté des messages de ce compagnon dans le panneau de discussion. Sans envoi, le logo par défaut du plugin est utilisé ; un envoi prend effet immédiatement et remplace le précédent, sans cliquer sur « Enregistrer ».',
  avatarUpload: 'Envoyer un avatar',
  avatarChange: 'Changer',
  avatarUploading: 'Envoi…',
  avatarUploaded: 'Avatar mis à jour',
  globalTitle: 'Interrupteurs globaux',
  globalHint:
    "Partagés par tous les compagnons (un pet pack peut les remplacer dans son propre fichier de type). Ces interrupteurs ne modifient que l'état local et sont écrits dans la configuration utilisateur lors de l'enregistrement (jamais immédiatement) ; les notifications système sont relues juste après l'enregistrement, sans rafraîchir la page.",
  cornerHint: "Le coin de l'écran auquel le compagnon se colle (par zone de travail de chaque écran en mode bureau).",
  marginXHint: "Distance horizontale au coin choisi (px) ; n'importe quel nombre.",
  marginYHint: "Distance verticale au coin choisi (px) ; n'importe quel nombre.",
  // 「/」命令菜单的行标题（图标由 app.ts 经 command-faces.ts 补上）。
  'cmd.chat': 'Discussion',
  'cmd.pet': 'Compagnon',
  'cmd.balance': 'Solde',
  'shortcut.open': 'Ouvrir le chat du compagnon',
  'shortcut.chat': 'Ouvrir la fenêtre de chat',
  'shortcut.hear': 'Saisie vocale',
  'shortcut.capture': 'Capture d’écran vers le chat',
  shortcutCardTitle: 'Raccourcis',
  shortcutCardHint: 'Deux groupes une fois déployé : raccourcis du compagnon et raccourcis globaux.',
  shortcutRowChat: 'Ouvrir le chat',
  shortcutRowHold: 'Maintenir pour parler',
  shortcutRowHear: 'Saisie vocale',
  shortcutRowCapture: 'Capture d’écran',
  shortcutRowPaste: 'Coller une image',
  shortcutRowTodo: 'Tâches',
  shortcutRowSleep: 'Dormir / réveiller',
  shortcutRowDisplay: 'Position d’affichage',
  shortcutRowSidebar: 'Ouvrir le chat latéral',
  shortcutGroupPet: 'Raccourcis du compagnon',
  shortcutGroupPetHint:
    'Sur le web, il suffit de survoler le compagnon. Dans la fenêtre du bureau, cliquez d’abord sur le compagnon pour qu’il prenne le focus clavier.',
  shortcutGroupGlobal: 'Raccourcis globaux',
  shortcutGroupGlobalHint:
    'Distribués par DSH dans le web et la fenêtre du bureau ; modifiables dans Réglages → Général → Raccourcis.',
  petsLabel: 'Compagnons',
  add: 'Ajouter un compagnon',
  remove: 'Supprimer',
  confirmRemove: 'Supprimer le compagnon « {id} » ?',
  confirmTitle: "Confirmer l'action",
  cancel: 'Annuler',
  ok: 'Compris',
  atLeastOne: 'Gardez au moins un compagnon.',
  emptyPets: "Aucun compagnon pour l'instant — cliquez sur « Ajouter un compagnon » pour en créer un.",
  sizeLabel: 'Taille (largeur px)',
  sizeHint:
    'Le curseur et le champ numérique écrivent la même valeur, 120–2048. La hauteur est automatique = largeur × 9/16.',
  sizesOf: 'Taille pour {renderer}',
  sizeFollowDefault: 'Suivre la valeur par défaut',
  sizePercentLabel: 'Largeur d’écran max (%)',
  sizePercentHint:
    'Part de la largeur d’écran que le pet peut occuper : 100 = jamais plus large qu’un écran (identique au px sur une fenêtre large) ; 30–40 le rend nettement plus petit sur téléphone sans changer le bureau. Calculé une fois au chargement ; rechargez après redimensionnement.',
  nameLabel: 'Nom',
  nameHint:
    "Affiché au survol du compagnon et ajouté aux personas de l'IA (« votre nom est X »). Les doublons sont permis ; laissé vide, l'identifiant du compagnon est utilisé.",
  personaLabel: 'Persona (facultatif)',
  personaHint:
    "Ne concerne que ce compagnon. Laissez vide pour suivre le persona de l'entrée — le texte grisé dans le champ est exactement celui-ci. Le system réellement envoyé au modèle = ce texte + la ligne « votre nom est <nom> » ajoutée automatiquement + le contexte temporel courant ; ne répétez donc ni le nom ni la date ici.",
  personaCount: '{n} caractères',
  balanceEnabled: 'Fonction solde',
  balanceEnabledHint: "Une fois activée, ce compagnon joue l'animation de solde et affiche la bulle de solde.",
  whisperEnabled: 'Murmures',
  whisperEnabledHint:
    "Une fois activé, ce compagnon génère périodiquement une phrase via l'IA et joue l'animation de murmure (persona = le champ ci-dessous ; vide = celui de l'entrée).",
  workStatusEnabled: "Suivi de l'état de travail",
  workStatusEnabledHint:
    "Une fois activé, ce compagnon suit l'état de travail de DSH : réflexion / travail / attente de confirmation / terminé / erreur déclenchent l'animation correspondante et une bulle (le pool se trouve au niveau supérieur de la configuration ; écoute seule, aucun appel au modèle).",
  fixedEnabled: 'Compagnon fixe',
  fixedEnabledHint:
    "Une fois activé, la chaîne aléatoire ne fait plus se retourner ni s'éloigner le compagnon — seules les actions sur place sont jouées. Les déclenchements par menu contextuel et par API, ainsi que les animations solde / murmure / état de travail, ne sont pas affectés.",
  clickThrough: 'Clic traversant',
  clickThroughHint:
    "Une fois activé, la fenêtre de bureau de ce compagnon ignore entièrement la souris : les clics passent à l'application en dessous et le compagnon ne peut plus être manipulé. Uniquement sur le bureau — la superposition web reste déplaçable. Le menu contextuel devient alors inaccessible : décochez cette case pour le désactiver.",
  displayLabel: 'Affichage',
  displayHint: 'web = navigateur seul / desktop = bureau seul / both = les deux / none = aucun',
  'display.web': 'Navigateur seul',
  'display.desktop': 'Bureau seul',
  'display.both': 'Les deux',
  'display.none': 'Aucun',
  rendererLabel: 'Rendu',
  rendererHint:
    'webm = animation vidéo / layered = PNG en couches (skins surfcore) / live2d = modèle Cubism. Les trois types sont exclusifs ; changer reconstruit immédiatement la scène.',
  'renderer.webm': 'webm (vidéo)',
  'renderer.layered': 'layered (PNG)',
  'renderer.live2d': 'live2d (Cubism)',
  cornerLabel: 'Position',
  'corner.top-left': 'En haut à gauche',
  'corner.top-right': 'En haut à droite',
  'corner.bottom-left': 'En bas à gauche',
  'corner.bottom-right': 'En bas à droite',
  marginX: 'Décalage horizontal',
  marginY: 'Décalage vertical',
  saveHotkey: 'Ctrl+S / Cmd+S',
  corruptTitle: 'Configuration utilisateur corrompue — non enregistrée',
  corruptConfirm: 'Enregistrer quand même',
  corruptBody:
    'Le fichier de configuration utilisateur est illisible (corrompu, JSON/JSONC invalide) : {path}. Enregistrer maintenant le reconstruit à partir de la liste blanche — tout son contenu actuel (animations / physics / memes, etc.) sera perdu. Annuler = ne pas toucher au fichier (corrigez-le puis enregistrez) ; Confirmer = enregistrer quand même (le contenu actuel du fichier est abandonné).',
  configMeta: 'Configuration avancée (fichiers)',
  configMetaHint:
    "La configuration utilisateur peut remplacer la liste des compagnons / les pools d'animation / les poids ; rechargez la page ou redémarrez pour appliquer : rafraîchissez la page dans le navigateur, ou sur le bureau, clic droit sur un compagnon → « Recharger la configuration » (reconstruit toutes les fenêtres de compagnons). La configuration par défaut est la référence complète.",
  defaultConfig: 'Configuration par défaut (lecture seule, référence complète)',
  userConfig: 'Configuration utilisateur (remplacements personnalisés)',
  todosFile: 'Données de tâches (texte, échéance et état ; les supprimer vide toutes les tâches)',
  animationDir: 'Dossier des animations (pour ajouter ou personnaliser des animations)',
  memesDir: 'Dossier des mèmes (pour ajouter ou personnaliser des images)',
  poolDir: 'Dossier du pool de ressources (skins / modèles / animations / sons partagés)',
  logFile: 'Fichier journal (pour le dépannage ; peut être vidé)',
  logFileNote:
    "L'application de bureau n'a pas de console : tous les journaux d'exécution du plugin (démarrage, plantages / redémarrages des compagnons, erreurs et avertissements) sont écrits dans ce seul fichier — joignez-le à vos rapports de problème. Limité à 1 Mo ; une fois plein, seuls les 512 Ko les plus récents sont conservés.",
  saved: 'Enregistré — les compagnons sont à jour immédiatement.',
  loadError: 'Échec du chargement de la configuration',
  saveError:
    "Échec de l'enregistrement de la configuration. Vérifiez la connexion au serveur, les droits d'écriture du dossier de configuration et le journal du serveur.",
  saveInvalid: "Échec de l'enregistrement : configuration invalide. Vérifiez les valeurs et réessayez.",
  loading: 'Chargement de la configuration…',
  retry: 'Réessayer',
  invalid: "Vérifiez votre saisie : la taille doit être positive ; les marges peuvent être n'importe quel nombre.",
  extraPetsHint:
    "{n} autre(s) type(s) proviennent de fichiers du dossier pet/ (<nom>-config.json + <nom>-animation/) ; basculez dessus dans la ligne « Types » ci-dessus. L'enregistrement écrit dans la configuration propre à chaque pack, jamais dans main-config.jsonc.",
  kindLabel: 'Types',
  kindMain: 'Intégré',
  lastOfKind:
    "« {entry} » n'a plus que ce compagnon — le supprimer ferait disparaître tout le type. Pour le retirer complètement, supprimez les fichiers du pack.",
  savePartial:
    "Compagnons principaux enregistrés, mais {names} n'ont pas pu être écrits : vérifiez que la configuration du pack est valide et que le dossier est accessible en écriture.",
  notifyToggle: 'Notifications système',
  notifyToggleHint:
    "Notifications du système d'exploitation (en bas à droite du bureau) pour la fin d'une conversation, les échecs, les demandes de permission et les questions — uniquement lorsque cette fenêtre n'a pas le focus.",
  sfxToggle: 'Son',
  sfxToggleHint:
    'Joue les fichiers configures et detectes automatiquement ; desactive coupe tout. On configure rarement : un click.wav dans le dossier du skin, dans pet/<root>-sound/ ou a cote d une animation est repris seul. Sans fichier, les sons integres prennent le relais.',
  sfxKeepAliveToggle: "Maintenir l'audio pret",
  sfxKeepAliveToggleHint:
    'Garde la sortie audio ouverte avec une source inaudible de 1 LSB : le premier son apres une longue pause ne perd pas son attaque, et le mixeur systeme garde une entree « Electron » comme volume global. Cout : peripherique occupe et batterie ; Windows ne se met generalement pas en veille avec un flux actif.',
  sfxVolumeLabel: 'Volume des sons',
  sfxVolumeHint:
    'Multiplie le volume de chaque effet : 0 coupe seulement les effets (la voix reste), 1 est le maximum. Entree du mixeur = second volume global.',
  sfxTitle: 'Sons d evenement',
  sfxHint:
    'C est l hote qui choisit le fichier : dossier du skin > dossier -sound > a cote de l animation > partage utilisateur > paquet. Cette page ne regle que les interrupteurs ; le volume est dans Global.',
  sfxFileHint:
    'Pour changer un fichier, placez l audio dans le dossier du skin (pet/xxx-skin/click.wav) ou pet/<root>-sound/ ; le nom du fichier est celui du moment. Rechargez ensuite la page.',
  sfxSlotPattern: 'Nom de fichier : {name}.wav ou <skin>-{name}.wav',
  sfxNone: 'aucun fichier',
  sfxTry: 'Ecouter',
  sfxSlotClick: 'Clic',
  sfxSlotThrow: 'Lancer',
  sfxSlotFloor: 'Atterrissage',
  sfxSlotWall: 'Mur',
  sfxSlotCeiling: 'Plafond',
  sfxSlotPet: 'Choc',
  sfxSlotSleepStart: 'Endormissement',
  sfxSlotSleepEnd: 'Reveil',
  sfxOriginSkin: 'skin',
  sfxOriginSound: 'dossier son',
  sfxOriginAnimation: 'dossier animation',
  sfxOriginUser: 'partage',
  sfxOriginDefault: 'integre',
  sfxOriginConfig: 'configuration',
  sfxOriginNone: 'non trouve',
  sfxOriginPoolSkin: 'pool · ressource',
  sfxOriginPoolRenderer: 'pool · renderer',
  sfxOriginPoolGlobal: 'pool · global',
  sfxWhereToPut: 'Placez le fichier ici : {path}',
  sfxHooksTitle: 'Hooks personnalises',
  sfxHooksHint:
    'Enregistrez un nom ici puis declenchez-le avec POST /sfx/<nom>?pet=<id> ; le fichier est trouve par la regle de nommage, sans config.',
  sfxHookAdd: 'Enregistrer',
  sfxHookPlaceholder: 'nom du hook, ex. ding',
  sfxHookInvalid: 'Lettres, chiffres, tiret bas ou tiret uniquement (1-64 caracteres)',
  sfxHookExists: 'Ce nom est deja enregistre',
  sfxHookRemove: 'Retirer',
  sfxHookPattern: 'Nom de fichier : hook-<nom>.wav ou <skin>-hook-<nom>.wav, dans le dossier du skin ou -sound',
  sfxHookEmpty: 'Aucun hook : enregistrez un nom ci-dessus ou deposez hook-<nom>.wav.',
  sfxHookCurlHint: 'Exemple : curl -X POST "http://127.0.0.1:3099/dsh-pet-7340/sfx/ding?pet=main"',
  sfxHookBuiltinTag: 'declencheur integre',
  sfxOpenFolder: 'Ouvrir le dossier',
  sfxOpenFolderFailed: 'Impossible d ouvrir le dossier : pas de reponse de l hote.',
  sfxFolderMissing: 'Ce dossier n existe pas encore. Le creer ?',
  sfxFolderCreateYes: 'Oui',
  sfxFolderCreateNo: 'Non',
  sfxFolderDismiss: 'Compris',
  whisperImageToggle: 'Images des murmures',
  whisperImageToggleHint:
    "Joindre un mème tiré au hasard dans le pool à chaque murmure (la correspondance des images se trouve dans le champ memes, au niveau supérieur de la configuration). Tokens : un murmure appelle déjà le modèle à chaque cycle ; l'image ajoute seulement le nom + la description de ce mème (environ 100 caractères / ~60 tokens) à la même requête — négligeable.",
  chatImageToggle: 'Images de discussion',
  chatImageToggleHint:
    "L'IA choisit un mème du pool adapté au contexte (facultatif ; la correspondance se trouve dans le champ memes, au niveau supérieur de la configuration). Tokens : chaque message transporte tout le catalogue — actuellement environ 1,1 k caractères (~650 tokens, soit environ 11 fois le cas des murmures) et cela croît avec le nombre d'images ; désactivé, rien du tout n'est ajouté.",
  chatAnimationToggle: 'Actions en discussion',
  chatAnimationToggleHint:
    "Une fois activé, la requête de discussion transporte la liste des animations jouables (toutes les actions de animations.categories) : si le modèle estime que la réplique joue réellement l'une d'elles, le compagnon la joue immédiatement ; sinon il répond seulement en texte. Tokens : chaque message transporte toute la liste ; désactivé, rien n'est ajouté. Valeur par défaut globale pour tous les compagnons (un pet pack peut la surcharger dans son propre fichier de configuration).",
  confineToggle: "Limiter à l'écran actuel",
  confineToggleHint:
    "Multi-écrans : une fois activé, le compagnon reste sur l'écran où il se trouve — un compagnon lancé ne rebondit que sur l'écran du relâchement (les jointures d'écrans font office de murs, il ne passe pas sur l'écran voisin) et l'errance autonome ne se fait que sur l'écran actuel (tout pas qui franchirait la jointure est annulé). Désactivé, il traverse les écrans comme d'habitude. Mode bureau uniquement — l'overlay du navigateur reste de toute façon dans la zone visible.",
  trayToggle: 'Zone de notification',
  trayToggleHint:
    "Affiche une icône dans la zone de notification (barre de menus sur macOS) dès que le mode bureau démarre. Elle liste tous les compagnons de la configuration et permet de basculer chacun entre bureau et web / aucun — y compris ceux qui ne sont pas sur le bureau et n'ont donc aucune fenêtre à cliquer droit. Une fois désactivée, ramener un compagnon sur le bureau exige d'ouvrir le navigateur (la page de configuration, ou un clic droit sur le compagnon web). Windows range déjà ces icônes dans le panneau « icônes masquées ». Mode bureau uniquement.",
  voiceTitle: 'Synthèse vocale',
  voiceHint:
    "Quatre interrupteurs et une voix : chaque type de parole a son propre interrupteur, aucun ne dépend d'un autre. Tout est désactivé par défaut et écrit dans la configuration utilisateur lors de l'enregistrement (jamais immédiatement).",
  voicePreview: 'Écouter',
  voicePreviewLoading: 'Synthèse…',
  voicePreviewPlaying: 'Lecture en cours',
  voicePreviewFailed: "Échec de l'écoute : service vocal ou réseau indisponible",

  voiceEnabled: 'Lire les murmures manuels',
  voiceEnabledHint:
    "Lit les murmures déclenchés par le clic droit ou une commande slash, ainsi que les réponses de discussion. Le bouton haut-parleur du panneau de discussion lit une seule réplique dès que vous appuyez. Cela ne décide que du son émis : bulles, mémoire de discussion et pop-ups de notification système restent intacts ; un échec de synthèse est seulement journalisé et n'interrompt jamais la conversation.",
  voiceWhisperEnabled: 'Lire les murmures',
  voiceWhisperEnabledHint:
    "Lit le murmure généré périodiquement. Désactivé par défaut — les murmures sont une narration de fond et ne doivent pas faire de bruit sans qu'on le demande.",
  voiceTodoEnabled: 'Lire les rappels de tâches',
  voiceTodoEnabledHint:
    "Lit un rappel de tâche à son échéance (la bulle s'affiche toujours ; cet interrupteur décide seulement s'il est lu). Désactivé par défaut.",
  voiceNotifyEnabled: "Lire l'état de travail",
  voiceNotifyEnabledHint:
    "Lit une réplique d'état de travail configurée quand une tâche se termine, échoue ou attend votre confirmation. Comme les notifications système, elle n'est lue que lorsque vous n'êtes pas sur cette page (autre application, sans focus, réduite) — aucune interruption pendant que vous regardez l'écran. Seule la réplique configurée est lue, jamais le détail de la tâche. Désactivé par défaut.",
  speakStripEmoji: 'Retirer les emoji a la lecture',
  speakStripEmojiHint:
    'Retire les emoji (🙂 / ❤️ / 🇨🇳) du texte avant la synthese : le synthetiseur les lit comme un mot. Une ligne faite uniquement d emoji est ignoree. Actif par defaut ; ne touche qu au texte lu.',
  voiceNameLabel: 'Voix',
  voiceLocalLabel: 'Voix (locale)',
  voiceLocalHint: 'Timbre du service vocal local ; s’applique dès la phrase suivante',
  voiceNameFallbackHint: 'Ignore tant que la voix locale est disponible : ne choisit que la voix edge si GSV tombe',
  voiceProviderTitle: 'Voix locale (GSV)',
  voiceProviderHint:
    'URL du service GPT-SoVITS et dossiers de ressources ; les voix sont rescannées après enregistrement',
  voiceProviderSave: 'Enregistrer la connexion',
  voiceProviderSaved: 'Enregistré ; liste des voix actualisée',
  voiceProviderReady: 'Service en ligne',
  voiceProviderStart: 'Demarrer le service',
  voiceProviderStop: 'Arreter le service',
  voiceProviderStarted: 'Demarrage envoye ; disponible sous 40 secondes',
  voiceProviderStopped: 'Arret envoye',
  voiceVolumeLabel: 'Volume',
  voiceVolumeHint:
    'Volume de lecture en décimal 0–1 : 1 correspond au volume maximal (100 %), 0 coupe le son. Seule l’intensité change et l’audio n’est pas resynthétisé, donc le régler ne coûte rien de plus. Les quatre types de parole partagent ce même volume.',
  physicsTitle: 'Physique (ressenti du glisser-lancer)',
  physicsHint:
    "Valeurs par défaut globales, partagées par tous les compagnons (un pet pack peut les remplacer dans son propre fichier de type) ; écrites dans la configuration utilisateur lors de l'enregistrement (jamais immédiatement). Appliquées immédiatement dans le navigateur ; sur le bureau, après que l'enregistrement a rechargé les fenêtres des compagnons.",
  mobileTitle: 'Effets mobiles',
  mobileHint:
    "Ces réglages n'ont de sens que dans un navigateur mobile : la vibration exige un moteur, les deux interrupteurs de mouvement exigent des capteurs d'inclinaison / d'accélération, et ces capteurs ne fonctionnent qu'en HTTPS ou sur localhost.",
  'physics.gravity': 'Gravité',
  'physics.gravityHint':
    'px/s², plus la valeur est élevée, plus la chute est rapide ; 0 = apesanteur (trajectoire rectiligne uniforme)',
  'physics.restitution': 'Rebond',
  'physics.restitutionHint':
    '0 à 1, proportion de vitesse conservée lors du rebond contre un mur ou le sol (1 = parfaitement élastique, 0 = arrêt net)',
  'physics.groundFriction': 'Frottement de contact',
  'physics.groundFrictionHint':
    'par seconde, atténuation de la vitesse le long de toute surface touchée (mur, sol, plafond) ; 0 = verglas partout',
  'physics.throwPower': 'Force de lancer',
  'physics.throwPowerHint':
    '> 0, multiplicateur global du suivi ressort et de la vitesse de lancer (1 = valeur par défaut ; plus haut = suivi plus ferme et lancers plus violents)',
  physicsCeilingBounce: 'Rebond au plafond',
  physicsCeilingBounceHint: "Désactivé, un lancer peut sortir par le haut de l'écran (la gravité le ramène)",
  physicsPetCollision: 'Collisions entre compagnons',
  physicsPetCollisionHint:
    'Un compagnon en vol rebondit sur les autres en conservant la quantité de mouvement (masse ∝ taille²)',
  physicsHaptic: 'Vibration aux collisions',
  physicsHapticHint:
    'Une vibration par impact (murs, sol, plafond, autres compagnons). Fonctionne dans Chrome/Edge ; pas sur iOS ni dans les coques WebView comme Via. Le mode Ne pas déranger la bloque.',
  physicsTilt: 'Gravité par inclinaison',
  physicsTiltHint:
    'Inclinez le téléphone : la gravité suit (valeur = celle ci-dessus) ; avec une gravité à 0, l’inclinaison n’a aucun effet. Nécessite HTTPS/localhost.',
  physicsShake: 'Secouer pour lancer',
  physicsShakeHint:
    'Secouez pour lancer le compagnon dans le sens du geste ; la force suit throwPower. Indépendant de la gravité, donc utilisable à gravité 0. Nécessite HTTPS/localhost.',
  invalidPhysics:
    'Vérifiez les paramètres physiques : gravité / frottement au sol ≥ 0, rebond entre 0 et 1, force de lancer > 0.',
  fontTitle: 'Apparence et police',
  fontHint:
    "La famille s'applique partout où la police bonbon est utilisée : bulle du compagnon, infobulle, fenêtre de discussion, fenêtre de score ; la taille ne concerne que la bulle et l'infobulle (les fenêtres de discussion et de score gardent la leur). Valeurs globales par défaut, partagées par tous les compagnons (un pet pack peut les remplacer dans son propre fichier de type) ; écrites dans la configuration utilisateur lors de l'enregistrement — immédiat dans le navigateur, et sur le bureau après rechargement des fenêtres par l'enregistrement.",
  fontFamilyLabel: 'Police',
  fontFamilyHint:
    "« Bonbon (intégrée) » est fournie avec le plugin ; les autres sont des polices système. Si une police manque sur la machine, la pile passe à la suivante (jamais de vide ni d'erreur).",
  fontSizeLabel: 'Taille de police (px)',
  fontSizeHint:
    "Taille du texte des bulles ; l'infobulle et les petites lignes de la bulle suivent proportionnellement. Plage 4 à 200.",
  fontFollowToggle: "Mettre la police à l'échelle du compagnon",
  fontFollowToggleHint:
    'Activé (par défaut) : la police grandit avec le compagnon — à 462 px de largeur, elle correspond exactement à la taille ci-dessus. Désactivé : la taille reste fixe quelle que soit la taille du compagnon.',
  invalidFont:
    'Vérifiez les réglages de police : la famille doit figurer dans la liste et la taille doit être un nombre entre 4 et 200.',
  'font.candy': 'Bonbon (intégrée)',
  'font.yahei': 'Microsoft YaHei / PingFang',
  'font.youyuan': 'YouYuan',
  'font.kaiti': 'KaiTi',
  'font.simsun': 'SimSun',
  'font.comic': 'Comic Sans MS',
  'font.system': 'Police système',
  modelTitle: 'Discussion et modèles',
  modelHint:
    "Quel modèle utilisent les murmures et la discussion, et combien d'historique chaque requête transporte. « Suivre la conversation actuelle » utilise le modèle de votre conversation en cours (par défaut). Valeur globale par défaut : s'applique à tous les compagnons, et un pet pack peut la remplacer dans son propre fichier de type. Les options viennent de la même source que le sélecteur de modèles de DSH, fournies en direct par l'hôte.",
  modelFollow: 'Suivre la conversation actuelle',
  modelSearch: 'Rechercher un modèle…',
  modelEmpty: 'Aucun modèle correspondant.',
  modelNoModels: 'Aucun modèle disponible.',
  modelLoading: 'Actualisation de la liste des modèles…',
  modelTriggerAria: 'Choisir un modèle, actuellement {model}',
  modelUnknown: ' (configuration actuelle, absent de la liste)',
  modelNone: 'Aucun modèle disponible pour ce fournisseur',
  whisperModelLabel: 'Modèle des murmures',
  chatModelLabel: 'Modèle de discussion',
  modelFieldHint:
    '« Suivre la conversation actuelle » utilise le modèle de la conversation ; si un modèle choisi échoue, le plugin revient au modèle de la conversation et réessaie une fois.',
  invalidModel:
    'Vérifiez les réglages de modèle : choisissez à la fois un fournisseur et un modèle, ou laissez les deux vides (suivre la conversation actuelle).',
  modelCatalogFailed:
    'Échec du chargement de la liste des modèles (rafraîchissez la page pour réessayer) ; vos valeurs actuelles sont conservées telles quelles.',
  chatMemory: "Tours d'historique de discussion",
  chatMemoryHint:
    'Nombre de tours récents transportés par chaque requête de discussion (1 tour = 1 question + 1 réponse ; 0 = aucun historique, chaque message repart de zéro). La mémoire elle-même conserve tout — cette valeur décide seulement de ce qui entre dans le contexte : plus elle est élevée, plus le compagnon se souvient, et plus cela coûte de tokens. Valeur globale par défaut, partagée par tous les compagnons (un pet pack peut la remplacer dans son propre fichier de type).',
  invalidChatMemory: "Vérifiez les tours d'historique : il faut un nombre ≥ 0.",
  chatImageLimit: "Limite d'images de discussion",
  chatImageLimitHint:
    'Nombre maximal de mèmes proposés au modèle pendant la discussion (« N premiers » = les N premières entrées de la configuration ; déplacez en tête celles que vous voulez voir partir en priorité). Toute la liste est jointe à chaque message et les tokens croissent linéairement avec le nombre, donc une longue liste coûte cher ; la limiter aux N premières restreint le choix du modèle à celles-là. 0 = aucune limite (tout envoyer). Valeur intégrée par défaut : 10. Valeur globale par défaut, partagée par tous les compagnons (un pet pack peut la remplacer dans son propre fichier de type). Discussion uniquement — un murmure ne porte que le mème tiré.',
  invalidChatImageLimit: "Vérifiez la limite d'images de discussion : il faut un nombre ≥ 0 (0 = aucune limite).",
  notifyTest: 'Tester la notification',
  notifyTestOk: 'Notification de test envoyée — regardez en bas à droite de votre bureau.',
  notifyDenyUnsupported:
    "Les notifications système ne sont pas prises en charge dans cet environnement (pas d'API Notification).",
  notifyDenyBlocked: "L'autorisation de notification est bloquée par le navigateur.",
  notifyDenyRejected: "Vous avez choisi « Bloquer » dans la demande d'autorisation.",
  notifyDenyError: "Échec de la demande d'autorisation",
  notifyGuide:
    "Marche à suivre : cliquez sur l'icône 🔒/ⓘ à gauche de la barre d'adresse → « Paramètres du site » → « Notifications » → choisissez « Autoriser », puis rafraîchissez la page et réessayez.",
  storageTitle: 'Désinstallation et stockage',
  storageHint:
    'Tous les emplacements où ce plugin écrit sur la machine. Supprimer les caches est sans risque (ils sont retéléchargés / reconstruits) ; supprimer les « données utilisateur du plugin » fait perdre la configuration et la mémoire de discussion.',
  'storage.userData':
    'Données utilisateur du plugin : configuration personnalisée main-config.jsonc, mémoire de discussion memory.json, animations personnalisées main-animation/, compagnons fichiers pet/',
  'storage.electron':
    'Runtime Electron du compagnon de bureau (volumineux ; retéléchargé automatiquement au prochain démarrage du mode bureau)',
  'storage.desktopCache':
    "Cache des fenêtres de compagnons et cache d'échelle de l'écran principal (suppression sans risque, reconstruit automatiquement)",
  'storage.electronCache':
    "Cache de téléchargement de l'installateur Electron (suppression sans risque, retéléchargé si besoin)",
  'storage.package':
    'Le plugin lui-même (géré par DSH — retirez-le avec la commande ci-dessous plutôt que de le supprimer à la main)',
  storageMissing: ' (pas encore créé)',
  uninstallTitle: 'Comment désinstaller',
  uninstallStep1:
    "1. Quittez d'abord DSH (le compagnon de bureau s'arrête avec lui) ; ne supprimez pas ces fichiers pendant que le compagnon tourne.",
  uninstallStep2:
    '2. Retirez le plugin lui-même (dans un terminal ; il est aussi retiré de la couche bundle du profil) :',
  uninstallStep3:
    '3. Supprimez les emplacements ci-dessus selon vos besoins : les caches sont sans risque ; supprimer les « données utilisateur du plugin » fait perdre la configuration et la mémoire de discussion (sauvegardez main-config.jsonc si vous voulez le garder).',
  motionTitle: 'Fréquence des actions',
  motionHint:
    "Quatre champs : repos / rotation / déplacement sont modifiables ; l'action aléatoire est calculée (100 − les trois autres). Valeur globale pour tous les compagnons ; un pet pack peut la remplacer dans son fichier de type.",
  'motion.idle': 'Repos',
  'motion.turn': 'Rotation',
  'motion.move': 'Déplacement',
  'motion.action': 'Action aléatoire',
  uninstallCmd: 'dsh plugin --profile {profile} remove dsh-pet',
  // 会话鱼设置（并入本页后从 pet.sessionFish 命名空间搬来）。
  'fish.intro':
    'Chaque session nouvelle, en cours ou tout juste terminée reçoit une petite animation « écrire du code ». Glissez pour déplacer, cliquez pour ouvrir, × pour retirer.',
  'fish.enabled': 'Activer les poissons de session',
  'fish.enabledHint':
    'Désactiver retire les poissons actuels et masque la couche ; ils reviennent à la prochaine activité après réactivation.',
  'fish.size': "Taille de l'animation",
  'fish.sizeHint': "Largeur (px) ; la hauteur suit le ratio de l'apparence (0,5–2× la largeur).",
  'fish.skin': 'Apparence',
  'fish.skinHint':
    'Les animations intégrées sont prêtes ; déposez votre image / GIF / webm dans le dossier des apparences puis cliquez sur « Rescanner ».',
  'fish.skinDefault': 'Par défaut (écrire du code)',
  'fish.skinDefaultName': 'Apparence par défaut',
  'fish.skinBuiltin': 'Intégrées',
  'fish.skinMine': 'Les miennes',
  'fish.skinMissing': '(fichier introuvable)',
  'fish.skinRescan': 'Rescanner',
  'fish.skinRescanned': 'Analyse terminée : ',
  'fish.skinRescanFailed': "Échec de l'analyse : liste indisponible",
  'fish.openSkinFolder': 'Ouvrir le dossier des apparences',
  'fish.followPet': 'Tourner autour du compagnon',
  'fish.followPetHint':
    "Désactivé, les poissons s'empilent de nouveau en bas à droite. Activé, ils orbitent autour du compagnon, le suivent et sont bousculés ; après un glisser, ils sont projetés puis reviennent à leur place.",
  'fish.maxCount': 'Nombre maximal',
  'fish.maxCountHint':
    'Les poissons en trop sont retirés en commençant par les plus anciens terminés ; les sessions actives restent.',
  'fish.bubbleSec': 'Durée de la bulle',
  'fish.bubbleSecHint':
    'Secondes pendant lesquelles une phrase reste affichée. Les poissons terminés attendent l’ouverture de leur session.',
  'fish.progressGapSec': 'Intervalle de progression',
  'fish.progressGapSecHint':
    'Secondes minimales entre deux annonces de progression. Les fins de tour ne sont pas limitées.',
  'fish.speakEnabled': 'Annonces vocales',
  'fish.speakEnabledHint':
    'Interrupteur principal : désactivé, progression, fin de tour et attente restent muettes, la bulle s’affiche toujours. Les trois interrupteurs par type ci-dessous s’appliquent quand il est actif.',
  'fish.speakProgress': 'Lire la progression',
  'fish.speakProgressHint': 'Lire la dernière phrase pendant la réflexion, le travail ou le rangement.',
  'fish.speakTurnEnd': 'Lire la fin de tour',
  'fish.speakTurnEndHint': 'Lire à chaque fin de tour (terminé, erreur ou tour intermédiaire d’objectif).',
  'fish.speakWaiting': 'Lire les attentes',
  'fish.speakWaitingHint': 'Lire quand une approbation, une question ou une revue de plan attend votre réponse.',
  'fish.resetPositions': 'Réinitialiser les positions',
  'fish.positionsReset': 'Positions réinitialisées ; les poissons reviennent près du compagnon.',
  'fish.preview': 'Aperçu',
  // 底部操作栏、重置、改动圆点与拆分后的卡片标题（会话鱼并入本页时新增）。
  tabPet: 'Compagnon',
  intro:
    "Organisé par usage : animal, aspect et ressenti, son, discussion, poisson de session, système. Enregistrez avec « Appliquer » ou « OK » en bas. Tant que des modifications sont en attente, l'onglet et sa carte affichent un point ; « Annuler les modifications » revient aux valeurs du fichier de configuration.",
  petCardHint:
    'Réglages par compagnon : nom / taille / affichage / position / décalages / cinq interrupteurs. Utilisez Appliquer ou OK en bas pour enregistrer.',
  tabFish: 'Poissons de session',
  tabBehavior: 'Comportement',
  tabAudio: 'Son',
  tabChat: 'Dialogue',
  tabSystem: 'Système',
  barGroup: 'Actions des réglages',
  barConfirm: 'OK',
  barCancel: 'Annuler',
  barApply: 'Appliquer',
  barRestart: 'Redémarrer',
  barConfirmHint: 'Enregistrer toutes les modifications et fermer les réglages.',
  barCancelHint:
    'Fermer les réglages et abandonner les modifications non enregistrées (la configuration est relue à la prochaine ouverture).',
  barApplyHint: 'Enregistrer toutes les modifications sans fermer.',
  barRestartHint:
    "Enregistrer d'abord, puis demander à l'hôte de recomposer le plugin et de reconstruire la fenêtre de bureau.",
  restarting: 'Redémarrage du plugin…',
  restartHmr: 'Plugin redémarré ; la page va se recharger.',
  restartHelper:
    'HMR indisponible : la fenêtre de bureau a été reconstruite, mais les modifications côté hôte nécessitent un redémarrage du profil.',
  restartFailed: 'Échec du redémarrage du plugin ; consultez le journal du plugin.',
  resetSettings: 'Réinitialiser les réglages',
  resetHint:
    'Restaure tous les réglages aux valeurs par défaut du projet (compagnons, personas, physique, police, son, voix, modèles et poissons de session). La confirmation écrit immédiatement.',
  confirmReset:
    'Tout réinitialiser ? La configuration par défaut intégrée écrasera la vôtre : compagnons, personas personnalisés, son / physique / police et le reste reviennent aux valeurs par défaut, et les commentaires du fichier sont réécrits. Les poissons de session sont aussi réinitialisés. Cette action est irréversible.',
  resetDone: 'Réinitialisé aux valeurs par défaut.',
  resetError:
    "Échec de la réinitialisation. Vérifiez la connexion au serveur et les droits d'écriture du répertoire de configuration.",
  resetPartial:
    "La configuration principale a été réinitialisée, mais les réglages des poissons de session n'ont pas été écrits : vérifiez que le répertoire de données est accessible en écriture.",
  unsaved: 'Modifications non enregistrées',
  sfxMasterTitle: 'Son global',
  sfxMasterHint:
    "L'interrupteur principal, le préchauffage et le volume global s'appliquent à tous les effets ; le fichier joué par chaque emplacement se règle dans « Effets par événement ».",
  systemTitle: 'Système et bureau',
  systemHint:
    'Ces interrupteurs ne changent que la façon dont cet ordinateur vous prévient et le comportement de la fenêtre ; les actions et la voix du compagnon ne changent pas.',
  'fish.cardTitle': 'Poissons de session',
  // 设置备份与恢复（系统分区）；两份原文 + 每个种类配置，恢复前留 .bak。
  backupTitle: 'Sauvegarde et restauration',
  backupHint:
    "Sauvegarde le texte brut de trois réglages modifiables : la configuration principale (compagnons et préférences globales), la configuration de chaque compagnon fichier et les réglages des poissons de session. Les commentaires et l'ordre des champs survivent à l'aller-retour. Non inclus : images d'avatar, mémoire de conversation, tâches, journaux et mémoire de position du navigateur. La restauration écrase les mêmes fichiers (un .bak est conservé avant) ; les fichiers de type absents de la sauvegarde ne sont pas touchés.",
  backupExport: 'Exporter la sauvegarde',
  backupRestore: 'Restaurer depuis une sauvegarde',
  backupDone: 'Sauvegarde exportée.',
  backupExportFailed: "Échec de l'export : l'hôte n'a pas répondu.",
  backupReadFailed: "Ce fichier n'est pas une sauvegarde de réglages de ce plugin.",
  backupUnsupported:
    'La sauvegarde vient d’une version plus récente du plugin ; mettez le plugin à jour avant de restaurer.',
  backupTooLarge: 'La sauvegarde est trop volumineuse ou contient trop d’entrées ; elle a été refusée.',
  restoreDone: 'Restauré depuis la sauvegarde ; les réglages sont actifs.',
  restoreFailed: 'Échec de la restauration : {message}',
  confirmRestore:
    'Écraser les réglages actuels avec « {name} » ? Les trois fichiers de configuration sont réécrits tels quels (les fichiers existants sont d’abord conservés en .bak). Action irréversible.',
  restoreConfirm: 'Restaurer',
  tabFeel: 'Aspect et ressenti',
  barDirty: '{n} modifications non enregistrées',
  barRevert: 'Annuler les modifications',
  barRevertHint: 'Abandonne les modifications non enregistrées et revient aux valeurs du fichier de configuration.',
  revertDone: 'Les modifications non enregistrées ont été abandonnées.',
  revertFailed: "Annulation impossible : la configuration n'a pas été chargée. Vérifiez la connexion au serveur.",
  secBasic: 'Essentiel',
  secDisplay: 'Affichage et position',
  secFeatures: 'Fonctions',
  secAdvanced: 'Avancé',
  maintenanceTitle: 'Maintenance',
  maintenanceHint:
    "Redémarrer le plugin, restaurer les valeurs par défaut et la façon dont cette page est organisée. Ces actions ne servent qu'une fois : elles restent hors de la barre du bas.",
  chatCostTitle: 'Ce que ces options coûtent en tokens',
  chatCostHint:
    "Chaque note correspond à une option ci-dessus. Une option désactivée n'envoie pas le moindre caractère au modèle.",
  sfxSourcesTitle: 'Sources, chemins et noms de fichiers',
  secSpeak: 'Lecture vocale',
  secTiming: 'Rythme',
  sizesTitle: 'Taille par moteur de rendu',
  extraPetsShort: '{n} autres types viennent du dossier pet/',
};

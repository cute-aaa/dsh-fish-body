/**
 * 设置页葡萄牙语文案；键集与 zh 完全一致。
 */
import type { Key } from './zh.ts';

export const pt: Record<Key, string> = {
  nav: 'Configuração do pet',
  tabLook: 'Aparência',
  petCardTitle: 'Pet',
  avatarLabel: 'Avatar',
  avatarHint:
    'A imagem pequena exibida ao lado das mensagens deste pet no painel de conversa. Sem envio, usa-se o logotipo padrão do plugin; o envio vale na hora e substitui o anterior, sem clicar em "Salvar".',
  avatarUpload: 'Enviar avatar',
  avatarChange: 'Trocar',
  avatarUploading: 'Enviando…',
  avatarUploaded: 'Avatar atualizado',
  globalTitle: 'Interruptores globais',
  globalHint:
    'Compartilhados por todos os pets (um pet pack pode sobrescrevê-los no arquivo do próprio tipo). Estes interruptores só mudam o estado local e são gravados na configuração do usuário ao "Salvar" (nunca na hora); as notificações do sistema são relidas logo após salvar, sem recarregar a página.',
  cornerHint: 'Em qual canto da tela o pet fica (no desktop, conforme a área de trabalho de cada monitor).',
  marginXHint: 'Distância horizontal até o canto escolhido (px); qualquer número.',
  marginYHint: 'Distância vertical até o canto escolhido (px); qualquer número.',
  // 「/」命令菜单的行标题（图标由 app.ts 经 command-faces.ts 补上）。
  'cmd.chat': 'Conversa',
  'cmd.pet': 'Pet',
  'cmd.balance': 'Saldo',
  'shortcut.open': 'Abrir o chat do pet',
  'shortcut.chat': 'Abrir a janela de chat',
  'shortcut.hear': 'Entrada de voz',
  'shortcut.capture': 'Captura de tela para o chat',
  shortcutCardTitle: 'Atalhos',
  shortcutCardHint: 'Ao expandir há dois grupos: atalhos do pet e atalhos globais.',
  shortcutRowChat: 'Abrir chat',
  shortcutRowHold: 'Segurar para falar',
  shortcutRowHear: 'Entrada de voz',
  shortcutRowCapture: 'Captura de tela',
  shortcutRowPaste: 'Colar imagem',
  shortcutRowTodo: 'Tarefas',
  shortcutRowSleep: 'Dormir / acordar',
  shortcutRowDisplay: 'Posição de exibição',
  shortcutRowSidebar: 'Abrir chat lateral',
  shortcutGroupPet: 'Atalhos do pet',
  shortcutGroupPetHint:
    'Na web basta passar o ponteiro sobre o pet. Na janela do desktop, clique no pet primeiro para ele receber o foco do teclado.',
  shortcutGroupGlobal: 'Atalhos globais',
  shortcutGroupGlobalHint:
    'São distribuídos pelo DSH na web e na janela do desktop; mudam em Configurações → Geral → Atalhos.',
  petsLabel: 'Pets',
  add: 'Adicionar pet',
  remove: 'Remover',
  confirmRemove: 'Excluir o pet "{id}"?',
  confirmTitle: 'Confirmar ação',
  cancel: 'Cancelar',
  ok: 'Entendi',
  atLeastOne: 'Mantenha pelo menos um pet.',
  emptyPets: 'Nenhum pet ainda — clique em "Adicionar pet" para criar.',
  sizeLabel: 'Tamanho (largura px)',
  sizeHint:
    'O controle deslizante e a caixa numérica gravam o mesmo valor, 120–2048. A altura é automática = largura × 9/16.',
  sizesOf: 'Tamanho para {renderer}',
  sizeFollowDefault: 'Seguir o padrão',
  sizePercentLabel: 'Largura máx. da tela (%)',
  sizePercentHint:
    'Quanto da largura da tela o pet pode ocupar: 100 = nunca mais largo que uma tela (igual ao px em janelas largas); 30–40 deixa bem menor no celular sem mudar o desktop. Calculado uma vez ao carregar; recarregue após redimensionar.',
  nameLabel: 'Nome',
  nameHint:
    'Nome exibido ao passar o mouse e incluído na persona da IA ("seu nome é X"). Pode repetir; vazio usa o id do pet.',
  personaLabel: 'Persona (opcional)',
  personaHint:
    'Vale só para este pet. Vazio = segue a persona da entrada — o texto cinza na caixa é exatamente isso. O system enviado ao modelo = este texto + uma linha "seu nome é <nome>" anexada automaticamente + o contexto de hora atual, então não repita o nome nem a data aqui.',
  personaCount: '{n} caracteres',
  balanceEnabled: 'Saldo',
  balanceEnabledHint: 'Quando ativado, este pet toca as animações de saldo e mostra o balão de saldo.',
  whisperEnabled: 'Sussurro',
  whisperEnabledHint:
    'Quando ativado, este pet gera uma frase com IA periodicamente e toca a animação de sussurro (persona = o campo abaixo; vazio segue a entrada).',
  workStatusEnabled: 'Status de trabalho',
  workStatusEnabledHint:
    'Quando ativado, este pet segue o estado de trabalho do DSH: pensando / trabalhando / aguardando confirmação / concluído / erro trocam a animação e mostram balões (o pool fica na configuração de topo; apenas escuta, sem chamar o modelo).',
  fixedEnabled: 'Fixar no lugar',
  fixedEnabledHint:
    'Quando ativado, a cadeia aleatória não gira nem afasta mais este pet — só tocam as ações de espera no lugar. Escolhas pelo menu de contexto, gatilhos da API e animações de saldo / sussurro / status de trabalho não são afetadas.',
  clickThrough: 'Clique atravessado',
  clickThroughHint:
    'Quando ativado, a janela de desktop deste pet ignora o mouse: os cliques passam para o aplicativo abaixo e o pet só pode ser visto. Vale apenas para o desktop — a camada web continua arrastável. O menu de clique direito também fica inacessível, então desmarque esta caixa para desativar.',
  displayLabel: 'Exibição',
  displayHint: 'web = só no navegador / desktop = só no desktop / both = nos dois / none = em nenhum',
  'display.web': 'Só no navegador',
  'display.desktop': 'Só no desktop',
  'display.both': 'Nos dois',
  'display.none': 'Em nenhum',
  rendererLabel: 'Renderizador',
  rendererHint:
    'webm = animação em vídeo / layered = PNG em camadas (skins surfcore) / live2d = modelo Cubism. Os três tipos são mutuamente exclusivos; trocar reconstrói o palco na hora.',
  'renderer.webm': 'webm (vídeo)',
  'renderer.layered': 'layered (PNG)',
  'renderer.live2d': 'live2d (Cubism)',
  cornerLabel: 'Posição',
  'corner.top-left': 'Canto superior esquerdo',
  'corner.top-right': 'Canto superior direito',
  'corner.bottom-left': 'Canto inferior esquerdo',
  'corner.bottom-right': 'Canto inferior direito',
  marginX: 'Deslocamento horizontal',
  marginY: 'Deslocamento vertical',
  saveHotkey: 'Ctrl+S / Cmd+S',
  corruptTitle: 'A configuração do usuário está corrompida — não salva',
  corruptConfirm: 'Salvar mesmo assim',
  corruptBody:
    'Não foi possível ler a configuração do usuário (conteúdo corrompido, não é JSON/JSONC válido): {path}. Salvar agora recria o arquivo a partir da lista branca — tudo o que está nele hoje (animações / física / memes etc.) será perdido. Cancelar = não mexe no arquivo (corrija e salve de novo); Confirmar = salva mesmo assim (descarta o conteúdo atual do arquivo).',
  configMeta: 'Configuração avançada (arquivos)',
  configMetaHint:
    'A configuração do usuário pode sobrescrever a lista de pets / pools de animação / pesos — recarregue ou reinicie para aplicar: no navegador atualize a página, no desktop clique com o botão direito no pet → "Recarregar configuração" (recria todas as janelas de pet do desktop); a configuração padrão é a referência completa.',
  defaultConfig: 'Configuração padrão (somente leitura, referência completa)',
  userConfig: 'Configuração do usuário (sobrescritas personalizadas)',
  todosFile: 'Dados de tarefas (texto, prazo e estado de conclusão; apagar equivale a limpar tudo)',
  animationDir: 'Pasta de animações (adicione ou personalize animações aqui)',
  memesDir: 'Pasta de memes (adicione ou personalize imagens aqui)',
  poolDir: 'Pasta do pool de recursos (skins / modelos / animações / sons compartilhados)',
  logFile: 'Arquivo de log (para diagnóstico; pode ser limpo)',
  logFileNote:
    'O app desktop do DSH não tem console, então todo log de execução do plugin (inicialização, travamentos e reinícios do pet, erros e avisos) vai para este único arquivo — anexe-o ao relatar um problema. Limite de 1 MB por arquivo; ao encher, só os 512 KB mais recentes são mantidos.',
  saved: 'Salvo — os pets atualizaram na hora.',
  loadError: 'Falha ao carregar a configuração',
  saveError:
    'Falha ao salvar a configuração. Verifique a conexão com o servidor, a permissão de escrita na pasta de configuração e o log do servidor.',
  saveInvalid: 'Falha ao salvar a configuração: conteúdo inválido. Revise os valores e tente de novo.',
  loading: 'Carregando configuração…',
  retry: 'Tentar de novo',
  invalid: 'Revise os valores: o tamanho precisa ser positivo; as margens podem ser qualquer número.',
  extraPetsHint:
    'Mais {n} tipo(s) vêm de arquivos na pasta pet/ (<nome>-config.json + <nome>-animation/). Troque para eles na linha "Tipos" acima; salvar grava no config de cada pacote, nunca no main-config.jsonc.',
  kindLabel: 'Tipos',
  kindMain: 'Embutido',
  lastOfKind:
    '"{entry}" tem só este pet — excluí-lo remove o tipo inteiro. Para remover de vez, apague os arquivos do pet pack.',
  savePartial:
    'Os pets principais foram salvos, mas {names} não pôde ser gravado: verifique se o config do pacote é válido e se a pasta permite escrita.',
  notifyToggle: 'Notificações do sistema',
  notifyToggleHint:
    'Avisos do sistema (canto inferior direito do desktop) para fim de conversa, falhas, pedidos de permissão e perguntas — só enquanto esta janela está sem foco.',
  sfxToggle: 'Som',
  sfxToggleHint:
    'Toca os arquivos configurados e os detectados automaticamente; desligado silencia tudo. Quase nunca precisa configurar: um click.wav na pasta da skin, em pet/<root>-sound/ ou ao lado de uma animacao e detectado. Sem arquivo valem os sons internos.',
  sfxKeepAliveToggle: 'Manter o audio pronto',
  sfxKeepAliveToggleHint:
    'Mantem a saida aberta com uma fonte inaudivel de 1 LSB: o primeiro som depois de muito tempo nao perde o ataque, e o mixer do sistema mantem uma entrada "Electron" como volume geral. Custa dispositivo e bateria; o Windows normalmente nao suspende com o fluxo ativo.',
  sfxVolumeLabel: 'Volume dos sons',
  sfxVolumeHint:
    'Multiplica o volume de cada efeito: 0 silencia apenas os efeitos (a voz continua), 1 e o maximo. A entrada do mixer e outro volume geral.',
  sfxTitle: 'Sons de evento',
  sfxHint:
    'O host decide qual arquivo toca em cada momento: pasta da skin > pasta -sound > ao lado da animacao > compartilhado > pacote. Esta pagina so muda interruptores; o volume fica em Global.',
  sfxFileHint:
    'Para trocar, coloque o audio na pasta da skin (pet/xxx-skin/click.wav) ou em pet/<root>-sound/; o nome do arquivo e o do momento. Recarregue a pagina depois.',
  sfxSlotPattern: 'Nome do arquivo: {name}.wav ou <skin>-{name}.wav',
  sfxNone: 'sem arquivo',
  sfxTry: 'Ouvir',
  sfxSlotClick: 'Clique',
  sfxSlotThrow: 'Arremesso',
  sfxSlotFloor: 'Pouso',
  sfxSlotWall: 'Parede',
  sfxSlotCeiling: 'Teto',
  sfxSlotPet: 'Choque',
  sfxSlotSleepStart: 'Dormir',
  sfxSlotSleepEnd: 'Acordar',
  sfxOriginSkin: 'skin',
  sfxOriginSound: 'pasta de som',
  sfxOriginAnimation: 'pasta de animacao',
  sfxOriginUser: 'compartilhado',
  sfxOriginDefault: 'interno',
  sfxOriginConfig: 'configuracao',
  sfxOriginNone: 'sem correspondencia',
  sfxOriginPoolSkin: 'pool · recurso',
  sfxOriginPoolRenderer: 'pool · renderer',
  sfxOriginPoolGlobal: 'pool · global',
  sfxWhereToPut: 'Coloque o arquivo aqui: {path}',
  sfxHooksTitle: 'Hooks proprios',
  sfxHooksHint:
    'Registre um nome aqui e dispare com POST /sfx/<nome>?pet=<id>; o arquivo e encontrado pela regra de nomes, sem editar configuracao.',
  sfxHookAdd: 'Registrar',
  sfxHookPlaceholder: 'nome do hook, ex. ding',
  sfxHookInvalid: 'Somente letras, digitos, sublinhado ou hifen (1-64 caracteres)',
  sfxHookExists: 'Esse nome ja esta registrado',
  sfxHookRemove: 'Remover',
  sfxHookPattern: 'Nome do arquivo: hook-<nome>.wav ou <skin>-hook-<nome>.wav, na pasta da skin ou -sound',
  sfxHookEmpty: 'Ainda sem hooks: registre um nome acima ou coloque hook-<nome>.wav.',
  sfxHookCurlHint: 'Exemplo: curl -X POST "http://127.0.0.1:3099/dsh-pet-7340/sfx/ding?pet=main"',
  sfxHookBuiltinTag: 'gatilho interno',
  sfxOpenFolder: 'Abrir pasta',
  sfxOpenFolderFailed: 'Nao foi possivel abrir a pasta de recursos: o host nao respondeu.',
  sfxFolderMissing: 'Esta pasta ainda nao existe. Criar?',
  sfxFolderCreateYes: 'Sim',
  sfxFolderCreateNo: 'Nao',
  sfxFolderDismiss: 'Entendi',
  whisperImageToggle: 'Imagens no sussurro',
  whisperImageToggleHint:
    'Anexa um meme aleatório do pool a cada sussurro (o mapeamento de imagens fica no campo de topo memes). Tokens: o sussurro já chama o modelo a cada ciclo, então a imagem só acrescenta o nome + a descrição daquele meme (~100 caracteres / ~60 tokens) ao mesmo pedido — desprezível.',
  chatImageToggle: 'Imagens na conversa',
  chatImageToggleHint:
    'Deixa a IA escolher um meme do pool conforme o contexto atual (opcional; o mapeamento fica no campo de topo memes). Tokens: cada mensagem leva o catálogo inteiro — hoje ~1,1 mil caracteres (~650 tokens, cerca de 11x o caso do sussurro) e cresce com o número de imagens; desligado, não acrescenta nada.',
  chatAnimationToggle: 'Ações na conversa',
  chatAnimationToggleHint:
    'Quando ligado, o pedido de conversa leva a lista de animações que podem ser encenadas (todas as ações de animations.categories): se o modelo considerar que a frase realmente encena uma delas, o pet a executa na hora; caso contrário responde só com texto. Tokens: cada mensagem leva a lista inteira; desligado não acrescenta nada. Valor padrão global para todos os pets (um pet pack pode substituí-lo no próprio arquivo de configuração).',
  confineToggle: 'Fixar na tela atual',
  confineToggleHint:
    'Vários monitores: quando ligado, o pet fica dentro da tela em que está — um pet arremessado quica só na tela onde foi solto (as emendas entre telas viram paredes, ele não voa para a tela vizinha), e o passeio autônomo só anda dentro da tela atual (o passo que cruzaria a emenda é cancelado). Desligado, ele cruza telas normalmente. Só afeta o modo desktop — o overlay do navegador já fica dentro da viewport.',
  trayToggle: 'Bandeja do sistema',
  trayToggleHint:
    'Mostra um ícone na área de notificação (barra de menus no macOS) quando o modo desktop inicia. Ele lista todos os pets da configuração e alterna a exibição de cada um — inclusive os que estão fora do desktop agora e não têm janela para clicar com o botão direito. Sem ele, para trazer um pet de volta ao desktop é preciso abrir o navegador (a página de configuração, ou clicar com o botão direito no pet na web). O Windows já esconde ícones de terceiros na gaveta "ícones ocultos". Só afeta o modo desktop.',
  voiceTitle: 'Voz',
  voiceHint:
    'Quatro interruptores e uma voz: cada tipo de fala tem o próprio interruptor e nenhum depende de outro. Tudo desligado por padrão; gravado na configuração do usuário ao "Salvar" (nunca na hora).',
  voicePreview: 'Ouvir',
  voicePreviewLoading: 'Sintetizando…',
  voicePreviewPlaying: 'Reproduzindo',
  voicePreviewFailed: 'Falha ao ouvir: serviço de voz ou rede indisponível',

  voiceEnabled: 'Falar sussurros manuais',
  voiceEnabledHint:
    'Fala os sussurros disparados pelo menu de contexto ou por um comando de barra, e também as respostas da conversa. O botão de alto-falante do painel de conversa fala uma única frase assim que você o aperta. Só decide se sai som: balões, memória da conversa e pop-ups de notificação do sistema não mudam; falha na síntese só gera log e nunca interrompe a conversa.',
  voiceWhisperEnabled: 'Falar sussurros',
  voiceWhisperEnabledHint:
    'Fala o sussurro gerado periodicamente. Desligado por padrão — sussurros são narração de fundo e não devem fazer barulho sem pedir.',
  voiceTodoEnabled: 'Falar lembretes de tarefas',
  voiceTodoEnabledHint:
    'Fala o lembrete quando uma tarefa vence (o balão continua aparecendo; isto só decide se fala). Desligado por padrão.',
  voiceNotifyEnabled: 'Falar estado de trabalho',
  voiceNotifyEnabledHint:
    'Fala uma frase configurada de estado de trabalho quando uma tarefa termina, falha ou aguarda sua confirmação. Como as notificações do sistema, só fala enquanto você não está nesta página (outro aplicativo, sem foco, minimizado) — sem interromper enquanto você olha para a tela. Só a frase configurada é falada, nunca o detalhe da tarefa. Desligado por padrão.',
  speakStripEmoji: 'Remover emoji na fala',
  speakStripEmojiHint:
    'Remove os emoji (🙂 / ❤️ / 🇨🇳) do texto antes de sintetizar: o sintetizador os le como palavra. Uma linha so de emoji e ignorada. Ligado por padrao; afeta so o texto falado.',
  voiceNameLabel: 'Voz',
  voiceLocalLabel: 'Voz (local)',
  voiceLocalHint: 'Timbre do servico de voz local; vale a partir da proxima frase',
  voiceNameFallbackHint: 'Ignorado enquanto a voz local estiver disponivel: so escolhe a voz edge se o GSV cair',
  voiceProviderTitle: 'Voz local (GSV)',
  voiceProviderHint: 'URL do GPT-SoVITS e pastas de material; as vozes sao reescaneadas ao salvar',
  voiceProviderSave: 'Salvar conexao',
  voiceProviderSaved: 'Salvo; lista de vozes atualizada',
  voiceProviderReady: 'Servico online',
  voiceProviderStart: 'Iniciar servico',
  voiceProviderStop: 'Parar servico',
  voiceProviderStarted: 'Inicio enviado; disponivel em cerca de 40 segundos',
  voiceProviderStopped: 'Parada enviada',
  voiceVolumeLabel: 'Volume',
  voiceVolumeHint:
    'Volume de reprodução em decimal 0–1: 1 é o volume máximo (100%) e 0 silencia. Altera apenas a intensidade e não sintetiza o áudio de novo, então ajustá-lo não custa nada extra. Os quatro tipos de fala compartilham este mesmo volume.',
  physicsTitle: 'Física (sensação de arrastar e arremessar)',
  physicsHint:
    'Padrão global, compartilhado por todos os pets (um pet pack pode sobrescrever no arquivo do próprio tipo); gravado na configuração do usuário ao "Salvar" (nunca na hora). No navegador vale na hora; no desktop vale quando o "Salvar" recarrega as janelas do pet.',
  mobileTitle: 'Efeitos no celular',
  mobileHint:
    'Só fazem sentido no navegador do celular: a vibração precisa de motor, os dois interruptores de movimento precisam de sensores de inclinação/aceleração, e os sensores exigem HTTPS ou localhost.',
  'physics.gravity': 'Gravidade',
  'physics.gravityHint': 'px/s² — quanto maior, mais rápido cai; 0 = sem gravidade (voa em linha reta para sempre)',
  'physics.restitution': 'Restituição',
  'physics.restitutionHint':
    '0–1, velocidade mantida ao quicar na parede ou no chão (1 = totalmente elástico, 0 = para na hora)',
  'physics.groundFriction': 'Atrito de contato',
  'physics.groundFrictionHint':
    'por segundo, perda de velocidade ao longo de qualquer superfície (parede, chão, teto); 0 = gelo em todas',
  'physics.throwPower': 'Força de arremesso',
  'physics.throwPowerHint':
    '> 0, multiplicador geral da mola que segue o cursor e da velocidade de saída (1 = padrão; maior = mais colado ao cursor e arremessos mais fortes)',
  physicsCeilingBounce: 'Quicar no teto',
  physicsCeilingBounceHint:
    'Desligado, o arremesso pode sair pelo topo da tela (a gravidade ainda traz o pet de volta)',
  physicsPetCollision: 'Colisão entre pets',
  physicsPetCollisionHint: 'Um pet em voo quica nos outros com conservação de momento (massa ∝ tamanho²)',
  physicsHaptic: 'Vibração ao colidir',
  physicsHapticHint:
    'Uma vibração por impacto (paredes, chão, teto, outros pets). Funciona no Chrome/Edge; não no iOS nem em navegadores WebView como o Via. O modo Não perturbe bloqueia o vibrador.',
  physicsTilt: 'Gravidade por inclinação',
  physicsTiltHint:
    'Incline o celular e a gravidade acompanha (magnitude = o valor acima); com gravidade em 0 a inclinação não faz nada. Requer HTTPS/localhost.',
  physicsShake: 'Sacudir para arremessar',
  physicsShakeHint:
    'Sacuda para arremessar o pet na direção do gesto; a força acompanha o throwPower. Independe da gravidade, então funciona com gravidade 0. Requer HTTPS/localhost.',
  invalidPhysics:
    'Revise os valores de física: gravidade / atrito com o chão ≥ 0, restituição 0–1, força de arremesso > 0.',
  fontTitle: 'Aparência e fonte',
  fontHint:
    'A família vale para todo texto que hoje usa a fonte candy: balão do pet, dica ao passar o mouse, janela de conversa, popup de pontuação. O tamanho vale só para o balão do pet e a dica (as janelas de conversa e de pontuação mantêm o próprio tamanho). Padrão global, compartilhado por todos os pets (um pet pack pode sobrescrever no arquivo do próprio tipo); gravado na configuração do usuário ao "Salvar" — na hora no navegador, e no desktop quando o "Salvar" recarrega as janelas do pet.',
  fontFamilyLabel: 'Fonte',
  fontFamilyHint:
    '"Candy (embutida)" vem com o plugin; as demais são fontes do sistema. Se faltar na máquina, cai para a próxima da pilha (nunca fica em branco nem dá erro).',
  fontSizeLabel: 'Tamanho da fonte (px)',
  fontSizeHint:
    'Tamanho do texto do balão; a dica e as linhas menores dentro do balão escalam na proporção. Faixa 4–200.',
  fontFollowToggle: 'Escalar a fonte com o tamanho do pet',
  fontFollowToggleHint:
    'Ligado (padrão): a fonte cresce com o pet — com 462 px de largura fica exatamente no tamanho definido acima. Desligado: o tamanho fica fixo, independente do pet.',
  invalidFont:
    'Revise as configurações de fonte: a família precisa estar na lista e o tamanho precisa ser um número entre 4 e 200.',
  'font.candy': 'Candy (embutida)',
  'font.yahei': 'Microsoft YaHei / PingFang',
  'font.youyuan': 'YouYuan',
  'font.kaiti': 'KaiTi',
  'font.simsun': 'SimSun',
  'font.comic': 'Comic Sans MS',
  'font.system': 'Padrão do sistema',
  modelTitle: 'Conversa e modelos',
  modelHint:
    'Qual modelo o sussurro e a conversa usam, e quanta história cada pedido de conversa carrega. "Seguir a conversa atual" usa o modelo da conversa em que você está (padrão). Padrão global: vale para todos os pets, e um pet pack pode sobrescrever no arquivo do próprio tipo. As opções vêm da mesma fonte do seletor de modelos do DSH, servidas pelo host em tempo real.',
  modelFollow: 'Seguir a conversa atual',
  modelSearch: 'Buscar modelos…',
  modelEmpty: 'Nenhum modelo corresponde.',
  modelNoModels: 'Nenhum modelo disponível.',
  modelLoading: 'Atualizando a lista de modelos…',
  modelTriggerAria: 'Escolher modelo, atual {model}',
  modelUnknown: ' (configuração atual, fora da lista)',
  modelNone: 'Este provedor não tem modelos disponíveis',
  whisperModelLabel: 'Modelo do sussurro',
  chatModelLabel: 'Modelo da conversa',
  modelFieldHint:
    '"Seguir a conversa atual" usa o modelo da conversa; se um modelo escolhido falhar, o plugin volta ao modelo da conversa e tenta mais uma vez.',
  invalidModel:
    'Revise as configurações de modelo: escolha provedor e modelo, ou deixe os dois vazios (seguir a conversa atual).',
  modelCatalogFailed:
    'Falha ao carregar a lista de modelos (atualize a página para tentar de novo); os valores atuais são mantidos como estão.',
  chatMemory: 'Rodadas de histórico',
  chatMemoryHint:
    'Quantas rodadas recentes cada pedido de conversa carrega (1 rodada = 1 pergunta + 1 resposta; 0 = sem histórico, cada mensagem começa do zero). A memória em si guarda tudo — isto só decide quanto entra no contexto: mais memória, mais tokens. Padrão global, compartilhado por todos os pets (um pet pack pode sobrescrever no arquivo do próprio tipo).',
  invalidChatMemory: 'Revise as rodadas de histórico: precisa ser um número ≥ 0.',
  chatImageLimit: 'Limite de imagens na conversa',
  chatImageLimitHint:
    'Quantos memes no máximo são listados ao modelo na conversa ("primeiros N" = os N primeiros da configuração, então mova para o começo os que quer enviar). A lista inteira vai em cada mensagem e os tokens crescem linearmente com a quantidade, então lista longa é gasto puro; limitar aos N primeiros faz o modelo escolher só entre eles. 0 = sem limite (envia tudo). Padrão embutido 10. Padrão global, compartilhado por todos os pets (um pet pack pode sobrescrever no arquivo do próprio tipo). Só afeta a conversa — o sussurro leva só o meme sorteado.',
  invalidChatImageLimit: 'Revise o limite de imagens na conversa: precisa ser um número ≥ 0 (0 = sem limite).',
  notifyTest: 'Testar notificação',
  notifyTestOk: 'Notificação de teste enviada — veja o canto inferior direito do desktop.',
  notifyDenyUnsupported: 'Este ambiente não suporta notificações do sistema (sem API Notification no navegador).',
  notifyDenyBlocked: 'A permissão de notificação está marcada como bloqueada pelo navegador.',
  notifyDenyRejected: 'Você escolheu "Bloquear" na janela de permissão.',
  notifyDenyError: 'Erro ao pedir permissão',
  notifyGuide:
    'Como liberar: clique no 🔒/ⓘ ao lado da barra de endereços → "Configurações do site" → "Notificações" → mude para "Permitir", atualize a página e tente de novo.',
  storageTitle: 'Desinstalação e armazenamento',
  storageHint:
    'Todos os lugares em que o plugin grava arquivos. Apagar caches não atrapalha (são baixados ou recriados sozinhos); apagar "dados do usuário do plugin" perde a configuração e a memória da conversa.',
  'storage.userData':
    'Dados do usuário do plugin: configuração personalizada main-config.jsonc, memória da conversa memory.json, animações personalizadas main-animation/, pets de arquivo pet/',
  'storage.electron':
    'Runtime Electron usado pelo pet do desktop (grande; é baixado de novo automaticamente na próxima vez que o modo desktop iniciar)',
  'storage.desktopCache':
    'Cache das janelas do pet e cache de escala do monitor principal (pode apagar; é recriado sozinho)',
  'storage.electronCache':
    'Cache de download do instalador do Electron (pode apagar; é baixado de novo quando preciso)',
  'storage.package': 'O plugin em si (gerenciado pelo DSH — remova com o comando abaixo em vez de apagar na mão)',
  storageMissing: ' (ainda não criado)',
  uninstallTitle: 'Como desinstalar',
  uninstallStep1:
    '1. Feche o DSH primeiro (o pet do desktop fecha junto); não apague os arquivos acima com o pet em execução.',
  uninstallStep2: '2. Remova o plugin em si (no terminal; isto também o tira da camada de bundle do profile):',
  uninstallStep3:
    '3. Apague os locais acima conforme a necessidade: caches não fazem falta; apagar "dados do usuário do plugin" perde a configuração e a memória da conversa (faça backup do main-config.jsonc antes, se quiser manter).',
  motionTitle: 'Frequência de ações',
  motionHint:
    'Quatro campos: espera / giro / movimento são editáveis; a ação aleatória é calculada (100 − as outras três). Padrão global para todos os pets; um pet pack pode sobrescrevê-lo no arquivo do tipo.',
  'motion.idle': 'Em espera',
  'motion.turn': 'Giro',
  'motion.move': 'Movimento',
  'motion.action': 'Ação aleatória',
  uninstallCmd: 'dsh plugin --profile {profile} remove dsh-pet',
  // 会话鱼设置（并入本页后从 pet.sessionFish 命名空间搬来）。
  'fish.intro':
    'Cada sessão nova, em andamento ou recém-concluída recebe uma pequena animação de «escrever código». Arraste para mover, clique para abrir, × para descartar.',
  'fish.enabled': 'Ativar peixes de sessão',
  'fish.enabledHint':
    'Ao desativar, os peixes atuais somem e a camada é ocultada; eles voltam na próxima atividade depois de reativar.',
  'fish.size': 'Tamanho da animação',
  'fish.sizeHint': 'Largura (px); a altura segue a proporção da aparência (0,5–2× a largura).',
  'fish.skin': 'Aparência',
  'fish.skinHint':
    'As animações integradas já funcionam; coloque sua imagem / GIF / webm na pasta de aparências e pressione «Reescanear».',
  'fish.skinDefault': 'Padrão (escrever código)',
  'fish.skinDefaultName': 'Aparência padrão',
  'fish.skinBuiltin': 'Integradas',
  'fish.skinMine': 'Minhas',
  'fish.skinMissing': '(arquivo não encontrado)',
  'fish.skinRescan': 'Reescanear',
  'fish.skinRescanned': 'Varredura concluída: ',
  'fish.skinRescanFailed': 'Falha na varredura: lista indisponível',
  'fish.openSkinFolder': 'Abrir pasta de aparências',
  'fish.followPet': 'Girar em volta do pet',
  'fish.followPetHint':
    'Desligado, os peixes voltam a empilhar no canto inferior direito. Ligado, eles orbitam o pet, o seguem e são empurrados; depois de arrastar, voam e retornam ao seu lugar.',
  'fish.maxCount': 'Máximo de peixes',
  'fish.maxCountHint': 'Os excedentes saem primeiro os concluídos mais antigos; sessões em andamento ficam.',
  'fish.bubbleSec': 'Duração do balão',
  'fish.bubbleSecHint': 'Segundos que uma frase fica no balão. Peixes concluídos esperam até você abrir a sessão.',
  'fish.progressGapSec': 'Intervalo de progresso',
  'fish.progressGapSecHint':
    'Segundos mínimos entre falas de progresso de uma sessão. Fins de turno não entram no limite.',
  'fish.speakEnabled': 'Anúncios de voz',
  'fish.speakEnabledHint':
    'Interruptor mestre: desligado, progresso, fim de turno e espera ficam mudos (o balão continua). Os três interruptores por tipo abaixo valem enquanto estiver ligado.',
  'fish.speakProgress': 'Falar o progresso',
  'fish.speakProgressHint': 'Falar a última frase ao pensar, trabalhar ou organizar.',
  'fish.speakTurnEnd': 'Falar o fim do turno',
  'fish.speakTurnEndHint': 'Falar ao fim de cada turno (concluído, erro ou rodada intermediária de um objetivo).',
  'fish.speakWaiting': 'Falar as esperas',
  'fish.speakWaitingHint': 'Falar quando uma aprovação, pergunta ou revisão de plano espera sua resposta.',
  'fish.resetPositions': 'Redefinir posições',
  'fish.positionsReset': 'Posições redefinidas; os peixes voltam ao lado do pet.',
  'fish.preview': 'Prévia',
  // 底部操作栏、重置、改动圆点与拆分后的卡片标题（会话鱼并入本页时新增）。
  tabPet: 'Pet',
  intro:
    'Tudo agrupado por função: pets, peixes de sessão, comportamento, aparência, som, diálogo e sistema. Altere o que precisar e use Aplicar / OK no rodapé; um ponto marca ajustes e abas com alterações não salvas.',
  petCardHint:
    'Configuração por pet: nome / tamanho / exibição / posição / deslocamentos / cinco interruptores. Use Aplicar ou OK no rodapé para salvar.',
  tabFish: 'Peixes de sessão',
  tabBehavior: 'Comportamento',
  tabAudio: 'Som',
  tabChat: 'Diálogo',
  tabSystem: 'Sistema',
  barGroup: 'Ações das configurações',
  barConfirm: 'OK',
  barCancel: 'Cancelar',
  barApply: 'Aplicar',
  barRestart: 'Reiniciar',
  barConfirmHint: 'Salvar todas as alterações e fechar as configurações.',
  barCancelHint:
    'Fechar as configurações e descartar as alterações não salvas (na próxima abertura a configuração é relida).',
  barApplyHint: 'Salvar todas as alterações sem fechar.',
  barRestartHint:
    'Salvar primeiro e depois pedir ao host para recompor o plugin e reconstruir a janela da área de trabalho.',
  restarting: 'Reiniciando o plugin…',
  restartHmr: 'Plugin reiniciado; a página será recarregada em instantes.',
  restartHelper:
    'HMR indisponível: a janela da área de trabalho foi reconstruída, mas alterações no host ainda exigem reiniciar o perfil.',
  restartFailed: 'Falha ao reiniciar o plugin; veja o log do plugin.',
  resetSettings: 'Redefinir configurações',
  resetHint:
    'Restaura todas as configurações para os padrões do projeto (pets, personas, física, fonte, som, voz, modelos e peixes de sessão). Ao confirmar, grava imediatamente.',
  confirmReset:
    'Redefinir tudo? A configuração padrão embutida substituirá a sua: pets, personas personalizadas, som / física / fonte e todo o resto voltam aos padrões, e os comentários do arquivo são reescritos. As configurações dos peixes de sessão também são redefinidas. Não é possível desfazer.',
  resetDone: 'Redefinido para os padrões embutidos.',
  resetError:
    'Falha ao redefinir. Verifique a conexão com o servidor e as permissões de escrita do diretório de configuração.',
  resetPartial:
    'A configuração principal foi redefinida, mas as configurações dos peixes de sessão não foram gravadas: verifique se o diretório de dados é gravável.',
  unsaved: 'Alterações não salvas',
  sfxMasterTitle: 'Som geral',
  sfxMasterHint:
    'O interruptor geral, o pré-aquecimento e o volume geral valem para todos os efeitos; qual arquivo toca em cada slot é definido em «Sons por evento» abaixo.',
  systemTitle: 'Sistema e área de trabalho',
  systemHint:
    'Estes interruptores mudam apenas como esta máquina avisa e como a janela se comporta; as ações e a voz do pet não mudam.',
  'fish.cardTitle': 'Peixes de sessão',
  // 设置备份与恢复（系统分区）；两份原文 + 每个种类配置，恢复前留 .bak。
  backupTitle: 'Backup e restauração',
  backupHint:
    'Salva o texto original de três configurações editáveis: a configuração principal (pets e preferências globais), a configuração de cada pet de arquivo e as configurações dos peixes de sessão. Comentários e ordem dos campos sobrevivem à ida e volta. Não inclui: imagens de avatar, memória de conversa, tarefas, logs ou a memória de posições do navegador. A restauração sobrescreve os mesmos arquivos (um .bak é guardado antes); arquivos de tipo ausentes do backup não são tocados.',
  backupExport: 'Exportar backup',
  backupRestore: 'Restaurar do backup',
  backupDone: 'Backup exportado.',
  backupExportFailed: 'Falha ao exportar: o host não respondeu.',
  backupReadFailed: 'Este arquivo não é um backup de configurações deste plugin.',
  backupUnsupported: 'O backup veio de uma versão mais nova do plugin; atualize o plugin antes de restaurar.',
  backupTooLarge: 'O backup é grande demais ou tem entradas demais; foi recusado.',
  restoreDone: 'Restaurado do backup; as configurações já valem.',
  restoreFailed: 'Falha ao restaurar: {message}',
  confirmRestore:
    'Sobrescrever as configurações atuais com «{name}»? Os três arquivos de configuração são reescritos como estão (os existentes são guardados antes como .bak). Não dá para desfazer.',
  restoreConfirm: 'Restaurar',
};

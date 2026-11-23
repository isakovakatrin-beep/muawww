'use strict';

const voices = [
  {name:'Ночной', note:'До₃', color:'#65bdc3', word:'мааау', box:[59,90,278,226], bubbles:[[165,-45]], level:75, pan:-34},
  {name:'Ванильный', note:'Соль₃', color:'#b18537', word:'мияуу', box:[365,84,279,225], bubbles:[[-103,261,true],[-28,238,true]], level:66, pan:-17},
  {name:'Трёхцветный', note:'До₄', color:'#b65380', word:'мав-мав', box:[856,62,275,226], bubbles:[[235,12],[313,-17]], level:63, pan:33},
  {name:'Рыжий', note:'Ми₄', color:'#739823', word:'мррр', box:[620,382,276,227], bubbles:[[-130,108,true],[217,-13]], level:66, pan:12},
  {name:'Цветочный', note:'Ля₄', color:'#9f5ac2', word:'мияв-мияв', box:[317,650,276,226], bubbles:[[-97,264,true],[-42,236,true]], level:54, pan:-8},
];

const parameters = [
  {key:'level', label:'Уровень', min:0, max:100, unit:'%'},
  {key:'pitch', label:'Высота', min:-12, max:12, unit:' пт'},
  {key:'attack', label:'Атака', min:8, max:450, unit:' мс'},
  {key:'release', label:'Затухание', min:30, max:1200, unit:' мс'},
  {key:'pan', label:'Панорама', min:-100, max:100, unit:''},
];

const power = document.querySelector('#power');
const status = document.querySelector('#status');
const volume = document.querySelector('#volume');
const tone = document.querySelector('#tone');
const echo = document.querySelector('#echo');
let audio;
let buffers;
let enabled = false;
let loading = false;

function ratios(audioParam, value) {
  audioParam.setTargetAtTime(value, audio.context.currentTime, .025);
}

function updateMix() {
  if (!audio) return;
  ratios(audio.master.gain, Math.pow(Number(volume.value)/100, .65) * 1.28);
  ratios(audio.filter.frequency, 370 * Math.pow(36, Number(tone.value)/100));
  ratios(audio.wet.gain, Number(echo.value)/100 * .62);
  ratios(audio.feedback.gain, .13 + Number(echo.value)/100 * .49);
}

function setupAudio() {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) throw new Error('Web Audio unavailable');
  const context = new Context();
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = .38;
  const delay = context.createDelay(1);
  delay.delayTime.value = .29;
  const feedback = context.createGain();
  const wet = context.createGain();
  const master = context.createGain();
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -11;
  compressor.ratio.value = 4;
  compressor.attack.value = .008;
  compressor.release.value = .18;

  filter.connect(master);
  filter.connect(delay);
  delay.connect(wet).connect(master);
  delay.connect(feedback).connect(delay);
  master.connect(compressor).connect(context.destination);
  audio = {context, filter, feedback, wet, master};
  updateMix();
}

function updateVoice(voice) {
  const playing = voice.playing;
  if (!playing) return;
  ratios(playing.source.playbackRate, Math.pow(2, voice.pitch/12));
  ratios(playing.level.gain, voice.level/100 * .39);
  ratios(playing.pan.pan, voice.pan/100);
}

function setVoice(voice, on, releaseOverride) {
  if (Boolean(voice.playing) === on || (on && !enabled)) return;
  const context = audio.context;
  const now = context.currentTime;

  if (on) {
    const source = context.createBufferSource();
    const envelope = context.createGain();
    const level = context.createGain();
    const pan = context.createStereoPanner();
    source.buffer = voice.buffer;
    source.loop = true;
    source.loopStart = .5;
    source.loopEnd = 2;
    source.playbackRate.value = Math.pow(2, voice.pitch/12);
    level.gain.value = voice.level/100 * .39;
    pan.pan.value = voice.pan/100;
    source.connect(envelope).connect(level).connect(pan).connect(audio.filter);
    const peakAt = now + voice.attack/1000;
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(1, peakAt);
    source.onended = () => {
      source.disconnect();
      envelope.disconnect();
      level.disconnect();
      pan.disconnect();
    };
    voice.playing = {source, envelope, level, pan, startedAt:now, peakAt};
    source.start(now);
  } else {
    const {source, envelope, startedAt, peakAt} = voice.playing;
    const duration = (releaseOverride ?? voice.release)/1000;
    const current = Math.min(1, (now - startedAt)/(peakAt - startedAt));
    envelope.gain.cancelScheduledValues(now);
    envelope.gain.setValueAtTime(current, now);
    envelope.gain.linearRampToValueAtTime(0, now + duration);
    source.stop(now + duration + .015);
    voice.playing = null;
  }

  voice.button.setAttribute('aria-pressed', on);
  voice.card.dataset.playing = String(on);
}

function stopAll() {
  for (const voice of voices) setVoice(voice, false, 45);
  if (!audio) return;
  const now = audio.context.currentTime;
  for (const param of [audio.wet.gain, audio.feedback.gain]) {
    param.cancelScheduledValues(now);
    param.setTargetAtTime(0, now, .012);
  }
}

function toggleVoice(voice) {
  if (!enabled) {
    status.textContent = 'Сначала нажмите «мяукать»';
    power.focus({preventScroll:true});
    return;
  }
  updateMix();
  setVoice(voice, !voice.playing);
}

power.addEventListener('click', async () => {
  if (loading) return;
  if (enabled) {
    stopAll();
    enabled = false;
    power.setAttribute('aria-pressed', 'false');
    status.textContent = 'Звук выключен';
    return;
  }
  loading = true;
  power.setAttribute('aria-busy', 'true');
  power.textContent = 'загрузка…';
  try {
    if (!audio) setupAudio();
    await audio.context.resume();
    buffers ||= await Promise.all(voices.map(async (_, index) => {
      const response = await fetch('assets/voice' + index + '.wav');
      if (!response.ok) throw new Error('Sample request failed');
      return audio.context.decodeAudioData(await response.arrayBuffer());
    }));
    for (const [index, voice] of voices.entries()) voice.buffer = buffers[index];
    updateMix();
    enabled = true;
    power.setAttribute('aria-pressed', 'true');
    status.textContent = 'Звук включён';
  } catch (error) {
    console.error(error);
    status.textContent = 'Не удалось загрузить звук. Нажмите кнопку ещё раз.';
    power.textContent = 'повторить';
  } finally {
    loading = false;
    power.removeAttribute('aria-busy');
    if (enabled) power.textContent = 'мяукать';
  }
});

for (const input of [volume, tone, echo]) {
  const flower = input.parentElement;
  const output = flower.querySelector('output');
  const label = output.textContent;
  let activePointer = null;

  function setFromPointer(event) {
    const rect = flower.getBoundingClientRect();
    const fraction = input === volume ? 1 - (event.clientY - rect.top)/rect.height :
      (event.clientX - rect.left)/rect.width;
    input.value = String(Math.round(Math.max(0, Math.min(1, fraction))*100));
    input.dispatchEvent(new Event('input'));
  }

  flower.addEventListener('pointerdown', event => {
    if (event.button !== 0 || activePointer !== null) return;
    event.preventDefault();
    input.focus({preventScroll:true});
    activePointer = event.pointerId;
    flower.setPointerCapture(activePointer);
    setFromPointer(event);
  });
  flower.addEventListener('pointermove', event => {
    if (event.pointerId === activePointer) setFromPointer(event);
  });
  flower.addEventListener('lostpointercapture', event => {
    if (event.pointerId === activePointer) activePointer = null;
  });
  input.addEventListener('input', () => {
    const value = Number(input.value);
    flower.style.setProperty('--position', (input === volume ? 100 - value : value) + '%');
    output.value = label + ' · ' + value + '%';
    if (enabled) updateMix();
  });
  input.dispatchEvent(new Event('input'));
}

function makeSceneVoice(voice, index) {
  const button = document.createElement('button');
  button.className = 'cat';
  button.type = 'button';
  button.setAttribute('aria-label', voice.name + ' кот, ' + voice.note);
  button.setAttribute('aria-keyshortcuts', String(index + 1));
  button.setAttribute('aria-pressed', 'false');
  const [x,y,w,h] = voice.box;
  for (const [key,value,base] of [['x',x,1440],['y',y,1024],['w',w,1440],['h',h,1024]]) {
    button.style.setProperty('--' + key, value/base*100 + '%');
  }
  button.style.setProperty('--bubble', voice.color);
  const img = new Image();
  img.src = 'assets/cat' + index + '.webp';
  img.alt = '';
  img.draggable = false;
  button.append(img);
  for (const [bx, by, flip] of voice.bubbles) {
    const bubble = document.createElement('span');
    bubble.className = flip ? 'bubble flip' : 'bubble';
    bubble.textContent = voice.word;
    bubble.setAttribute('aria-hidden', 'true');
    bubble.style.setProperty('--bx', bx/w*100 + '%');
    bubble.style.setProperty('--by', by/h*100 + '%');
    if (voice.word === 'мияв-мияв') bubble.style.minWidth = '13.1cqw';
    button.append(bubble);
  }
  button.addEventListener('click', () => toggleVoice(voice));
  document.querySelector('#cats').append(button);
  return button;
}

function makeSettings(voice, index) {
  const card = document.createElement('article');
  card.className = 'voice';
  card.style.setProperty('--color', voice.color);
  const heading = document.createElement('h3');
  const keyHint = document.createElement('kbd');
  keyHint.textContent = index + 1;
  heading.append(voice.name, keyHint);
  card.append(heading);

  for (const {key, label, min, max, unit} of parameters) {
    const row = document.createElement('div');
    row.className = 'parameter';
    const input = document.createElement('input');
    input.type = 'range';
    input.id = key + '-' + index;
    input.min = min;
    input.max = max;
    input.value = voice[key];
    const caption = document.createElement('label');
    caption.htmlFor = input.id;
    caption.textContent = label;
    input.setAttribute('aria-label', voice.name + ' — ' + label.toLowerCase());
    const output = document.createElement('output');
    output.htmlFor = input.id;
    function refresh() {
      const value = Number(input.value);
      voice[key] = value;
      output.value = key === 'pitch' ? voice.note + ' ' + (value >= 0 ? '+' : '') + value + unit :
        key === 'pan' ? (value === 0 ? 'Центр' : (value < 0 ? 'Л ' : 'П ') + Math.abs(value)) :
        value + unit;
      updateVoice(voice);
    }
    input.addEventListener('input', refresh);
    refresh();
    row.append(caption, output, input);
    card.append(row);
  }
  document.querySelector('#voices').append(card);
  return card;
}

for (const [index, voice] of voices.entries()) {
  Object.assign(voice, {pitch:0, attack:32, release:250, playing:null});
  voice.button = makeSceneVoice(voice, index);
  voice.card = makeSettings(voice, index);
}

document.querySelector('#stop').addEventListener('click', stopAll);
document.addEventListener('keydown', event => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'Escape') stopAll();
  if (/^[1-5]$/.test(event.key)) toggleVoice(voices[Number(event.key)-1]);
});

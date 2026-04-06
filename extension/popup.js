const $ = (id) => document.getElementById(id);

async function load() {
  const config = await chrome.storage.local.get({
    supabaseUrl: '',
    supabaseAnonKey: '',
    enabled: true,
    totalIngested: 0,
    lastIngest: null,
  });

  $('supabaseUrl').value = config.supabaseUrl;
  $('supabaseAnonKey').value = config.supabaseAnonKey;
  $('total').textContent = config.totalIngested;
  $('enableToggle').classList.toggle('on', config.enabled);

  if (config.lastIngest) {
    const diff = Date.now() - new Date(config.lastIngest).getTime();
    const mins = Math.floor(diff / 60000);
    $('lastSync').textContent = mins < 1 ? 'Just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
  }
}

$('enableToggle').addEventListener('click', async () => {
  const toggle = $('enableToggle');
  const isOn = toggle.classList.toggle('on');
  await chrome.storage.local.set({ enabled: isOn });
});

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    supabaseUrl: $('supabaseUrl').value.trim().replace(/\/$/, ''),
    supabaseAnonKey: $('supabaseAnonKey').value.trim(),
  });
  const status = $('status');
  status.style.display = 'block';
  setTimeout(() => { status.style.display = 'none'; }, 2000);
});

load();

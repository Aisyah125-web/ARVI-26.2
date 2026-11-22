// ==========================================
// 1. KONFIGURASI SUPABASE (GANTI DENGAN PUNYA ANDA)
// ==========================================
var SUPABASE_URL = 'https://geggbicbpirdqhlhoons.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_HrHXcHdBjv_SVmk20E_Ypg_5HdkgaMg';
var sb = null;

function getSupabase() {
    if (!sb) {
        if (!window.supabase) {
            throw new Error('Library Supabase belum termuat. Cek koneksi internet atau index.html.');
        }
        sb = window.supabase.createClient(SUPABASE_URL.trim(), SUPABASE_ANON_KEY.trim());
    }
    return sb;
}

// ==========================================
// 2. AUTENTIKASI (LOGIN, REGISTER, LOGOUT)
// ==========================================
var isRegisterMode = false;
var currentUser = null;

function toggleAuthMode(e) {
    e.preventDefault();
    isRegisterMode = !isRegisterMode;
    document.getElementById('authTitle').textContent = isRegisterMode ? 'Daftar Akun Baru' : 'Masuk ke Akun ARVI';
    document.getElementById('authDesc').textContent = isRegisterMode
        ? 'Buat akun untuk mulai menyimpan proyek survei jalan Anda.'
        : 'Silakan masuk untuk mengakses dan menyimpan proyek survei Anda.';
    document.getElementById('authSubmitBtn').textContent = isRegisterMode ? 'Daftar' : 'Masuk';
    document.getElementById('authToggleText').textContent = isRegisterMode ? 'Sudah punya akun?' : 'Belum punya akun?';
    document.getElementById('authToggleLink').textContent = isRegisterMode ? 'Masuk di sini' : 'Daftar sekarang';
    document.getElementById('authMsg').textContent = '';
}

async function handleAuth(e) {
    e.preventDefault();
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const msgEl = document.getElementById('authMsg');
    const btn = document.getElementById('authSubmitBtn');

    btn.disabled = true;
    msgEl.style.color = '#334b5b';
    msgEl.textContent = 'Memproses...';

    try {
        const client = getSupabase();
        if (isRegisterMode) {
            const { data, error } = await client.auth.signUp({ email, password });
            if (error) throw error;
            msgEl.style.color = '#2e7d32';
            msgEl.textContent = 'Registrasi berhasil! Jika verifikasi email aktif, cek inbox Anda, atau silakan masuk.';
            if (data.session) await initSession(data.session);
        } else {
            const { data, error } = await client.auth.signInWithPassword({ email, password });
            if (error) throw error;
            await initSession(data.session);
        }
    } catch (err) {
        msgEl.style.color = '#c0392b';
        msgEl.textContent = err.message;
    } finally {
        btn.disabled = false;
    }
}

async function logout() {
    await getSupabase().auth.signOut();
    currentUser = null;
    document.getElementById('app-shell').style.display = 'none';
    document.getElementById('auth-page').classList.remove('hidden');
}

async function initSession(session) {
    const shell = document.getElementById('app-shell');
    const authPage = document.getElementById('auth-page');

    if (!session) {
        shell.classList.add('hidden');
        shell.style.display = 'none';
        authPage.classList.remove('hidden');
        return;
    }
    currentUser = session.user;
    authPage.classList.add('hidden');
    shell.classList.remove('hidden');
    shell.style.display = 'contents';
    document.getElementById('userBadge').textContent = '● ' + currentUser.email;

    await loadProjects();
    const hashPage = location.hash.slice(1).split('#')[0];
    go(hashPage || 'dashboard');
}

// ==========================================
// 3. MANAJEMEN PROYEK SUPABASE (TERLINDUNG RLS)
// ==========================================
async function loadProjects() {
    const tbody = document.getElementById('projectRows');
    const recentEl = document.getElementById('recent');

    const { data, error } = await getSupabase()
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        tbody.innerHTML = `<tr><td colspan="5" style="color:red;">Gagal memuat: ${safe(error.message)}</td></tr>`;
        return;
    }

    document.getElementById('projectCount').textContent = data.length;

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">Belum ada proyek. Klik "+ Proyek Baru" untuk membuat.</td></tr>';
        recentEl.innerHTML = '<p class="muted">Belum ada proyek tersimpan pada akun ini.</p>';
        return;
    }

    tbody.innerHTML = data.map(p => `
        <tr>
            <td>${safe(p.name)}</td>
            <td>${safe(p.location)}</td>
            <td>${p.survey_count || 0}</td>
            <td>${safe(p.status)}</td>
            <td><button class="secondary" onclick="deleteProject('${p.id}')" style="padding:2px 8px;font-size:0.8rem;">Hapus</button></td>
        </tr>
    `).join('');

    recentEl.innerHTML = data.slice(0, 5).map(p => `
        <p>${safe(p.name)} <span class="tag">${safe(p.status)}</span></p>
    `).join('');
}

async function addProject() {
    if (!currentUser) return alert('Silakan login terlebih dahulu.');
    let n = prompt('Nama proyek baru:');
    if (!n) return;
    let l = prompt('Lokasi proyek:') || 'Belum ditentukan';

    const { error } = await getSupabase().from('projects').insert([{
        user_id: currentUser.id,
        name: n.trim(),
        location: l.trim(),
        survey_count: 0,
        status: 'Draft'
    }]);

    if (error) {
        alert('Gagal menyimpan proyek: ' + error.message);
        return;
    }
    await loadProjects();
}

async function deleteProject(id) {
    if (!confirm('Hapus proyek ini secara permanen?')) return;
    const { error } = await getSupabase().from('projects').delete().eq('id', id);
    if (error) {
        alert('Gagal menghapus: ' + error.message);
        return;
    }
    await loadProjects();
}

// ==========================================
// 4. LOGIKA ASLI ARVI (NAVIGASI, SURVEI, PENAMPANG)
// ==========================================
const pages = [...document.querySelectorAll('.page')];

function go(id) {
    pages.forEach(p => p.classList.toggle('hidden', p.id !== id));
    const crumb = document.getElementById('crumb');
    if (crumb) crumb.textContent = id.replace('-', ' ');
    location.hash = id;
    if (id === 'cross-section' || id === 'drawing-sheet') draw();
}

window.addEventListener('hashchange', () => {
    if (currentUser) go(location.hash.slice(1) || 'dashboard');
});

let surveys = 1;
function addSurvey() {
    let n = prompt('Nama ruas/titik:');
    if (!n) return;
    let sta = prompt('STA (contoh 0+000):') || '-';
    let tr = document.createElement('tr');
    tr.innerHTML = `<td>${safe(n)}</td><td>${safe(sta)}</td><td>-</td><td>Proyek aktif</td>`;
    document.getElementById('surveyRows').append(tr);
    surveys++;
    document.getElementById('surveyCount').textContent = surveys;
}

function safe(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function addLane() {
    let n = document.querySelectorAll('.lane').length + 1;
    let l = document.createElement('label');
    l.textContent = `Lajur ${n} (m)`;
    let i = document.createElement('input');
    i.type = 'number';
    i.min = '.1';
    i.step = '.1';
    i.value = '3.5';
    i.className = 'lane';
    l.append(i);
    document.getElementById('lanes').append(l);
    draw();
}

function v(id) {
    return Math.max(0, Number(document.getElementById(id)?.value) || 0);
}

function draw() {
    let lanes = [...document.querySelectorAll('.lane')].map(x => Math.max(.1, +x.value || 3.5));
    let widths = [v('dl'), v('swl'), v('shl'), ...lanes, v('median'), v('shr'), v('swr'), v('dr')];
    let total = widths.reduce((a, b) => a + b, 0);
    let x0 = 380 - total * 27 / 2, x = x0, base = 220, shapes = '';

    widths.forEach((w, i) => {
        if (!w) return;
        let color = (i === 0 || i === widths.length - 1) ? '#4e9ec0' : (i === 1 || i === widths.length - 2) ? '#6eaa86' : '#263744';
        let fill = (i === 0 || i === widths.length - 1) ? '#e8f5fa' : (i === 1 || i === widths.length - 2) ? '#edf6ef' : '#f5f6f7';
        shapes += `<rect x="${x}" y="${base - 30}" width="${w * 27}" height="30" fill="${fill}" stroke="${color}" stroke-width="2"/>`;
        x += w * 27;
    });

    let svg = `<text x="380" y="45" text-anchor="middle" font-size="14" font-weight="bold" fill="#243b4c">PENAMPANG MELINTANG JALAN</text>
               <line x1="60" y1="${base}" x2="700" y2="${base}" stroke="#9ba8b1"/>${shapes}
               <path d="M ${x0} 185 L 380 173 L ${x0 + total * 27} 185" fill="none" stroke="#263744" stroke-width="2"/>
               <text x="380" y="270" text-anchor="middle" font-size="12" fill="#334b5b">Lebar total: ${total.toFixed(2)} m</text>
               <text x="380" y="292" text-anchor="middle" font-size="10" fill="#84919a">Sisi kiri — Mahkota jalan — Sisi kanan</text>`;

    document.getElementById('drawing').innerHTML = svg;
    document.getElementById('sheetSvg').innerHTML = svg;
    document.getElementById('width').textContent = 'Lebar total: ' + total.toFixed(2) + ' m';
    document.getElementById('subtitle').textContent = document.getElementById('roadName').value + ' · STA ' + document.getElementById('sta').value;
    document.getElementById('sheetRoad').textContent = document.getElementById('subtitle').textContent;
}

document.addEventListener('input', e => {
    if (e.target.closest('#cross-section')) draw();
});

// Cek sesi login saat halaman pertama kali dibuka
window.addEventListener('DOMContentLoaded', async () => {
    try {
        const { data: { session } } = await getSupabase().auth.getSession();
        await initSession(session);
    } catch (e) {
        console.error(e);
    }
});
// Instalador do DigiDoc (DigiDoc-Setup.exe) - desenvolvido por Otavio Martins.
// Um arquivo so: o programa + o motor do scanner vao embutidos (recurso "DigiDoc.zip").
// Instala POR USUARIO (sem pedir administrador), cria os atalhos e aparece em
// Configuracoes > Aplicativos do Windows (o "Desinstalar" de la chama DigiDoc.exe --desinstalar).
// Reinstalar/atualizar por cima mantem a config e a pasta Digitalizado (elas nao estao no pacote).
//
//   DigiDoc-Setup.exe               -> janela do instalador
//   DigiDoc-Setup.exe /S [/D=pasta] -> silencioso (usado pela atualizacao automatica)
//
// Compilado com o csc do .NET Framework 4 (C# 5) - sem recursos de C# 6+.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Instalador
{
    public const string CHAVE_UNINSTALL = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\DigiDoc";
    public const string AUTOR = "Desenvolvido por Otavio Martins";
    public static string Versao = "?";
    public static bool SemAtalhoNemRegistro = false;

    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    [STAThread]
    static int Main(string[] args)
    {
        bool silencioso = false;
        string pasta = null;
        foreach (string a in args)
        {
            if (a.Equals("/S", StringComparison.OrdinalIgnoreCase)) silencioso = true;
            else if (a.Equals("/SEMATALHO", StringComparison.OrdinalIgnoreCase)) SemAtalhoNemRegistro = true; // testes
            else if (a.StartsWith("/D=", StringComparison.OrdinalIgnoreCase)) pasta = a.Substring(3).Trim().Trim('"');
        }
        Versao = LerTexto("versao.txt") ?? "?";
        if (string.IsNullOrEmpty(pasta))
            pasta = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "DigiDoc");

        if (silencioso)
        {
            try { Instalar(NormalizarPasta(pasta), true, true, null); return 0; }
            catch (Exception e)
            {
                try { File.WriteAllText(Path.Combine(Path.GetTempPath(), "digidoc-instalar-erro.txt"), e.ToString()); } catch { }
                return 1;
            }
        }
        try { SetProcessDPIAware(); } catch { }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new Janela(pasta));
        return 0;
    }

    static string LerTexto(string nome)
    {
        try
        {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(nome))
            using (StreamReader r = new StreamReader(s)) return r.ReadToEnd().Trim();
        }
        catch { return null; }
    }

    // sempre numa pasta propria chamada DigiDoc (nunca espalha arquivos na pasta escolhida)
    public static string NormalizarPasta(string p)
    {
        p = (p ?? "").Trim().Trim('"').TrimEnd('\\', '/');
        if (p.Length == 0) p = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "DigiDoc");
        p = Path.GetFullPath(p);
        if (!Path.GetFileName(p).Equals("DigiDoc", StringComparison.OrdinalIgnoreCase)) p = Path.Combine(p, "DigiDoc");
        return p;
    }

    // DigiDoc aberto rodando DESTA pasta (o de um pendrive pode continuar aberto)
    public static Process[] AbertosNaPasta(string pasta)
    {
        System.Collections.Generic.List<Process> lista = new System.Collections.Generic.List<Process>();
        string prefixo = pasta.TrimEnd('\\') + "\\";
        foreach (Process p in Process.GetProcessesByName("DigiDoc"))
        {
            try { if (p.MainModule.FileName.StartsWith(prefixo, StringComparison.OrdinalIgnoreCase)) lista.Add(p); }
            catch { }
        }
        return lista.ToArray();
    }

    // progresso(feito, total, texto). Lanca excecao se der errado.
    public static void Instalar(string pasta, bool atalhoMesa, bool atalhoMenu, Action<int, int, string> progresso)
    {
        foreach (Process p in AbertosNaPasta(pasta)) { try { p.Kill(); p.WaitForExit(8000); } catch { } }
        Directory.CreateDirectory(pasta);
        string raiz = Path.GetFullPath(pasta).TrimEnd('\\') + "\\";
        long bytes = 0;

        using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("DigiDoc.zip"))
        {
            if (s == null) throw new Exception("O instalador está corrompido (pacote não encontrado). Baixe de novo.");
            using (ZipArchive zip = new ZipArchive(s, ZipArchiveMode.Read))
            {
                int total = zip.Entries.Count, n = 0;
                foreach (ZipArchiveEntry e in zip.Entries)
                {
                    n++;
                    string alvo = Path.GetFullPath(Path.Combine(pasta, e.FullName.Replace('/', '\\')));
                    if (!alvo.StartsWith(raiz, StringComparison.OrdinalIgnoreCase)) continue; // nunca fora da pasta
                    if (string.IsNullOrEmpty(e.Name)) { Directory.CreateDirectory(alvo); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(alvo));
                    for (int tentativa = 1; ; tentativa++)
                    {
                        try { e.ExtractToFile(alvo, true); break; }
                        catch (IOException)
                        {
                            // antivirus ou o app fechando ainda segurando o arquivo
                            if (tentativa >= 20) throw;
                            Thread.Sleep(500);
                        }
                        catch (UnauthorizedAccessException)
                        {
                            if (tentativa >= 20) throw;
                            try { File.SetAttributes(alvo, FileAttributes.Normal); } catch { }
                            Thread.Sleep(500);
                        }
                    }
                    bytes += e.Length;
                    if (progresso != null && (n % 25 == 0 || n == total)) progresso(n, total, "Copiando arquivos… " + n + " de " + total);
                }
            }
        }

        if (progresso != null) progresso(1, 1, "Criando atalhos…");
        // marca de instalacao: o "Desinstalar" do app so remove pastas com esta marca
        File.WriteAllText(Path.Combine(pasta, "digidoc-instalado.txt"),
            "Instalado pelo DigiDoc-Setup.exe - nao apague (o desinstalador do app usa este arquivo).\r\n");

        string exe = Path.Combine(pasta, "DigiDoc.exe");
        if (!File.Exists(exe)) throw new Exception("A cópia terminou mas o DigiDoc.exe não apareceu em " + pasta);
        if (SemAtalhoNemRegistro) return;
        if (atalhoMesa) CriarAtalho(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "DigiDoc.lnk"), exe, pasta);
        if (atalhoMenu) CriarAtalho(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "DigiDoc.lnk"), exe, pasta);

        // Configuracoes > Aplicativos (por usuario: nao precisa de administrador)
        using (RegistryKey k = Registry.CurrentUser.CreateSubKey(CHAVE_UNINSTALL))
        {
            k.SetValue("DisplayName", "DigiDoc");
            k.SetValue("DisplayVersion", Versao);
            k.SetValue("Publisher", "Otavio Martins");
            k.SetValue("DisplayIcon", exe + ",0");
            k.SetValue("InstallLocation", pasta);
            k.SetValue("UninstallString", "\"" + exe + "\" --desinstalar");
            k.SetValue("NoModify", 1, RegistryValueKind.DWord);
            k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            k.SetValue("EstimatedSize", (int)Math.Min(int.MaxValue, bytes / 1024), RegistryValueKind.DWord);
            k.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
        }
    }

    static void CriarAtalho(string lnk, string alvo, string pasta)
    {
        try
        {
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(t);
            object a = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnk });
            Type ta = a.GetType();
            ta.InvokeMember("TargetPath", BindingFlags.SetProperty, null, a, new object[] { alvo });
            ta.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, a, new object[] { pasta });
            ta.InvokeMember("IconLocation", BindingFlags.SetProperty, null, a, new object[] { alvo + ",0" });
            ta.InvokeMember("Description", BindingFlags.SetProperty, null, a, new object[] { "DigiDoc - digitalizador de documentos" });
            ta.InvokeMember("Save", BindingFlags.InvokeMethod, null, a, null);
        }
        catch { /* sem atalho nao impede de usar */ }
    }
}

class Janela : Form
{
    TextBox txtPasta;
    CheckBox chkMesa, chkMenu, chkAbrir;
    ProgressBar barra;
    Label lblStatus;
    Button btnInstalar, btnCancelar, btnAlterar;
    bool instalando, terminou;
    string pastaFinal;

    static readonly Color AZUL = Color.FromArgb(47, 111, 235);
    static readonly Color ESCURO = Color.FromArgb(29, 31, 43);

    public Janela(string pasta)
    {
        Text = "Instalar DigiDoc";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false; MinimizeBox = true;
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 9.5f);
        BackColor = Color.White;
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(560, 430);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        Panel topo = new Panel();
        topo.SetBounds(0, 0, 560, 96);
        topo.BackColor = ESCURO;
        Controls.Add(topo);
        topo.Controls.Add(Rotulo("▣", new Font("Segoe UI Symbol", 26f), Color.FromArgb(110, 168, 255), 22, 18, 50, 50));
        topo.Controls.Add(Rotulo("DigiDoc", new Font("Segoe UI", 18f, FontStyle.Bold), Color.White, 74, 16, 300, 36));
        topo.Controls.Add(Rotulo("Instalador · versão " + Instalador.Versao, new Font("Segoe UI", 9.5f), Color.FromArgb(169, 176, 192), 76, 52, 300, 20));
        topo.Controls.Add(Rotulo(Instalador.AUTOR, new Font("Segoe UI", 8.5f), Color.FromArgb(120, 126, 145), 300, 66, 248, 18, ContentAlignment.MiddleRight));

        Controls.Add(Rotulo("Instalar em:", new Font("Segoe UI", 9.5f, FontStyle.Bold), Color.FromArgb(31, 35, 40), 24, 114, 300, 20));
        txtPasta = new TextBox();
        txtPasta.SetBounds(24, 138, 408, 26);
        txtPasta.Text = Instalador.NormalizarPasta(pasta);
        Controls.Add(txtPasta);
        btnAlterar = new Button();
        btnAlterar.Text = "Alterar…";
        btnAlterar.SetBounds(440, 136, 96, 30);
        btnAlterar.Click += delegate
        {
            using (FolderBrowserDialog d = new FolderBrowserDialog())
            {
                d.Description = "Escolha onde instalar (o DigiDoc cria a pasta \"DigiDoc\" dentro dela)";
                d.SelectedPath = Path.GetDirectoryName(txtPasta.Text);
                if (d.ShowDialog(this) == DialogResult.OK) txtPasta.Text = Instalador.NormalizarPasta(d.SelectedPath);
            }
        };
        Controls.Add(btnAlterar);

        chkMesa = Caixa("Criar atalho na Área de Trabalho", 182);
        chkMenu = Caixa("Criar atalho no Menu Iniciar", 208);
        chkAbrir = Caixa("Abrir o DigiDoc quando terminar", 234);

        Controls.Add(Rotulo("Não precisa de administrador nem de internet. Se já tiver o DigiDoc nesta pasta, ele é atualizado e seus PDFs e configurações continuam como estão.",
            new Font("Segoe UI", 8.5f), Color.FromArgb(101, 109, 118), 24, 266, 512, 36));

        barra = new ProgressBar();
        barra.SetBounds(24, 312, 512, 14);
        Controls.Add(barra);
        lblStatus = Rotulo("Pronto para instalar.", new Font("Segoe UI", 9f), Color.FromArgb(101, 109, 118), 24, 332, 512, 22);
        Controls.Add(lblStatus);

        btnCancelar = new Button();
        btnCancelar.Text = "Cancelar";
        btnCancelar.SetBounds(316, 376, 104, 34);
        btnCancelar.Click += delegate { if (!instalando) Close(); };
        Controls.Add(btnCancelar);

        btnInstalar = new Button();
        btnInstalar.Text = "Instalar";
        btnInstalar.SetBounds(428, 376, 108, 34);
        btnInstalar.BackColor = AZUL; btnInstalar.ForeColor = Color.White;
        btnInstalar.FlatStyle = FlatStyle.Flat; btnInstalar.FlatAppearance.BorderSize = 0;
        btnInstalar.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
        btnInstalar.Click += delegate { if (terminou) { Concluir(); } else Comecar(); };
        Controls.Add(btnInstalar);
        AcceptButton = btnInstalar;

        FormClosing += delegate(object s, FormClosingEventArgs e) { if (instalando) e.Cancel = true; };
    }

    Label Rotulo(string t, Font f, Color c, int x, int y, int w, int h) { return Rotulo(t, f, c, x, y, w, h, ContentAlignment.TopLeft); }
    Label Rotulo(string t, Font f, Color c, int x, int y, int w, int h, ContentAlignment al)
    {
        Label l = new Label();
        l.Text = t; l.Font = f; l.ForeColor = c; l.BackColor = Color.Transparent;
        l.AutoSize = false; l.TextAlign = al;
        l.SetBounds(x, y, w, h);
        return l;
    }

    CheckBox Caixa(string t, int y)
    {
        CheckBox c = new CheckBox();
        c.Text = t; c.Checked = true;
        c.SetBounds(24, y, 400, 24);
        Controls.Add(c);
        return c;
    }

    void Comecar()
    {
        try { pastaFinal = Instalador.NormalizarPasta(txtPasta.Text); }
        catch { MessageBox.Show(this, "Essa pasta não é válida.", "DigiDoc", MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
        txtPasta.Text = pastaFinal;

        if (Instalador.AbertosNaPasta(pastaFinal).Length > 0)
        {
            if (MessageBox.Show(this, "O DigiDoc está aberto. Salve o que estiver fazendo.\n\nFechar o DigiDoc e continuar?", "DigiDoc",
                MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return;
        }

        instalando = true;
        btnInstalar.Enabled = btnCancelar.Enabled = btnAlterar.Enabled = txtPasta.Enabled = false;
        chkMesa.Enabled = chkMenu.Enabled = chkAbrir.Enabled = false;
        bool mesa = chkMesa.Checked, menu = chkMenu.Checked;
        Thread t = new Thread(delegate()
        {
            Exception erro = null;
            try
            {
                Instalador.Instalar(pastaFinal, mesa, menu, delegate(int feito, int total, string txt)
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        barra.Maximum = Math.Max(1, total);
                        barra.Value = Math.Min(barra.Maximum, feito);
                        lblStatus.Text = txt;
                    });
                });
            }
            catch (Exception e) { erro = e; }
            BeginInvoke((MethodInvoker)delegate { Terminou(erro); });
        });
        t.IsBackground = true;
        t.Start();
    }

    void Terminou(Exception erro)
    {
        instalando = false;
        if (erro != null)
        {
            lblStatus.ForeColor = Color.FromArgb(209, 53, 44);
            lblStatus.Text = "Não consegui instalar.";
            MessageBox.Show(this, "Não consegui instalar:\n\n" + erro.Message + "\n\nFeche o DigiDoc (se estiver aberto) e tente de novo.",
                "DigiDoc", MessageBoxButtons.OK, MessageBoxIcon.Error);
            btnInstalar.Enabled = btnCancelar.Enabled = btnAlterar.Enabled = txtPasta.Enabled = true;
            chkMesa.Enabled = chkMenu.Enabled = chkAbrir.Enabled = true;
            return;
        }
        terminou = true;
        barra.Value = barra.Maximum;
        lblStatus.ForeColor = Color.FromArgb(31, 157, 87);
        lblStatus.Text = "✓ Pronto! DigiDoc instalado em " + pastaFinal;
        btnInstalar.Text = chkAbrir.Checked ? "Abrir" : "Concluir";
        btnInstalar.Enabled = true;
        btnCancelar.Enabled = true; btnCancelar.Text = "Fechar";
    }

    void Concluir()
    {
        if (chkAbrir.Checked)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(Path.Combine(pastaFinal, "DigiDoc.exe"));
                psi.WorkingDirectory = pastaFinal;
                Process.Start(psi);
            }
            catch { }
        }
        Close();
    }
}

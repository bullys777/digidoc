// Lancador do DigiDoc para o pendrive (desenvolvido por Otavio Martins).
// Fica na raiz do pendrive como "DigiDoc.exe": abre NA HORA uma telinha de
// "Abrindo..." e inicia DigiDoc\DigiDoc.exe; a telinha some quando o app aparece.
// Compilado com o csc do .NET Framework (C# 5) - sem recursos de C# 6+.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

static class Lancador
{
    [STAThread]
    static void Main()
    {
        string pasta = AppDomain.CurrentDomain.BaseDirectory;
        string exe = Path.Combine(Path.Combine(pasta, "DigiDoc"), "DigiDoc.exe");
        if (!File.Exists(exe))
        {
            MessageBox.Show("Não encontrei a pasta \"DigiDoc\" ao lado deste arquivo.\n\nProcurei em:\n" + exe,
                "DigiDoc", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        Process p;
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(exe);
            psi.WorkingDirectory = Path.GetDirectoryName(exe);
            psi.UseShellExecute = false;
            p = Process.Start(psi);
        }
        catch (Exception e)
        {
            MessageBox.Show("Não consegui abrir o DigiDoc:\n" + e.Message, "DigiDoc",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        Application.EnableVisualStyles();
        Form f = new Form();
        f.FormBorderStyle = FormBorderStyle.None;
        f.StartPosition = FormStartPosition.CenterScreen;
        f.ClientSize = new Size(360, 220);
        f.BackColor = Color.FromArgb(29, 31, 43);
        f.Text = "Abrindo DigiDoc";
        f.ShowInTaskbar = true;
        try { f.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        Label logo = NovoLabel("▣", 30f, FontStyle.Regular, Color.FromArgb(110, 168, 255), 18, "Segoe UI Symbol");
        Label titulo = NovoLabel("DigiDoc", 17f, FontStyle.Bold, Color.White, 74, "Segoe UI");
        Label sub = NovoLabel("Abrindo…", 10f, FontStyle.Regular, Color.FromArgb(169, 176, 192), 110, "Segoe UI");
        Label dica = NovoLabel("vindo do pendrive pode levar um tempinho", 8.5f, FontStyle.Regular, Color.FromArgb(120, 126, 145), 132, "Segoe UI");
        ProgressBar barra = new ProgressBar();
        barra.Style = ProgressBarStyle.Marquee;
        barra.MarqueeAnimationSpeed = 25;
        barra.SetBounds(70, 162, 220, 8);
        Label autor = NovoLabel("Desenvolvido por Otavio Martins", 8f, FontStyle.Regular, Color.FromArgb(107, 113, 132), 192, "Segoe UI");
        f.Controls.Add(logo); f.Controls.Add(titulo); f.Controls.Add(sub);
        f.Controls.Add(dica); f.Controls.Add(barra); f.Controls.Add(autor);

        DateTime inicio = DateTime.Now;
        Timer t = new Timer();
        t.Interval = 400;
        t.Tick += delegate
        {
            bool pronto;
            try { p.Refresh(); pronto = p.HasExited || p.MainWindowHandle != IntPtr.Zero; }
            catch { pronto = true; }
            if (pronto || (DateTime.Now - inicio).TotalMinutes > 10)
            {
                t.Stop();
                try
                {
                    if (p.HasExited && p.ExitCode != 0)
                        MessageBox.Show("O DigiDoc fechou ao abrir (código " + p.ExitCode + ").", "DigiDoc",
                            MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
                catch { }
                f.Close();
            }
        };
        t.Start();
        Application.Run(f);
    }

    static Label NovoLabel(string texto, float tamanho, FontStyle estilo, Color cor, int y, string fonte)
    {
        Label l = new Label();
        l.Text = texto;
        l.ForeColor = cor;
        l.BackColor = Color.Transparent;
        l.Font = new Font(fonte, tamanho, estilo);
        l.AutoSize = false;
        l.TextAlign = ContentAlignment.MiddleCenter;
        l.SetBounds(0, y, 360, (int)(tamanho * 2.4f) + 4);
        return l;
    }
}

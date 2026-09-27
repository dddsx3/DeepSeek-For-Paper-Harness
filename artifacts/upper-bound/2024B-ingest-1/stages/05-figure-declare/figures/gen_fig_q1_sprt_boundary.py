"""绘制序贯检验的接受与拒收边界及其间的继续抽样区域；单面板展示两条边界随抽样件数的变化；数据来自 R-Q1-sprt-m、R-Q1-sprt-accept-line、R-Q1-sprt-reject-line。"""
import matplotlib.pyplot as plt

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn


def main():
    doc = load("results.json")
    values = {item["result_id"]: item["value"] for item in doc["results"]}

    m = values["R-Q1-sprt-m"]
    accept = values["R-Q1-sprt-accept-line"]
    reject = values["R-Q1-sprt-reject-line"]

    fig, ax = plt.subplots(figsize=(6.0, 2.8))
    ax.plot(m, accept, color=PALETTE[0], linewidth=1.8, label=cn("接受边界"))
    ax.plot(m, reject, color=COLORS["accent"], linewidth=1.8, label=cn("拒收边界"))
    ax.fill_between(
        m,
        accept,
        reject,
        color=_lighten(PALETTE[0], 0.5),
        alpha=0.45,
        label=cn("继续抽样区域"),
    )

    ax.set_xlabel(cn("抽样件数"))
    ax.set_ylabel(cn("累积对数似然比边界"))
    ax.grid(axis="both", color=COLORS["grid"], linewidth=0.6, alpha=0.7)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.legend(frameon=False, ncol=3)
    panel(ax, "(a)")

    fig.tight_layout()
    save(fig, "fig_q1_sprt_boundary")


if __name__ == "__main__":
    main()

# Soul Quant Coin 公共测试网发布

本流程把钱包网页发布到 GitHub Pages，把 SQC 合约部署到 Sepolia。网页发布不等于合约已经部署：尚未获得测试 ETH 或尚未完成部署时，可以先发布“准备中”的页面；该页面不能挖矿或转账。

仓库 [Dryoung95/soul-quant-coin](https://github.com/Dryoung95/soul-quant-coin) 与公共网页 <https://dryoung95.github.io/soul-quant-coin/> 已上线，Sepolia 合约已成功部署，对应公共配置已导出。连接自己的 MetaMask 钱包后可提交挖矿和转账交易。

| 当前实例 | 值 |
|---|---|
| 合约 | `0x246296fCAa195069d69DbF04778600Dac31A0dB0` |
| 浏览器 | [查看合约](https://sepolia.etherscan.io/address/0x246296fCAa195069d69DbF04778600Dac31A0dB0) |
| 部署交易 | [查看部署交易](https://sepolia.etherscan.io/tx/0xe8b4de072495cb83c88471e165afe253fac34b64996101a0d5fe0ee719733f54) |
| 网络 / 链 ID | Sepolia / `11155111` |
| 预设 | `public-demo`，12 bits / 60 秒 |
| 部署区块 | `11905329` |

Sepolia 实际验证已完成：挖矿奖励 50 SQC，随后向 `0x12f1eEE3770adb7084b0E090e7495824281DF393` 转账 1.23456789 SQC；发送方剩余 48.76543211 SQC，总供应保持 50 SQC。[查看转账交易](https://sepolia.etherscan.io/tx/0x2b0c24aca59e63b072162f7bfdb087afa9032c57f0a03d7b149fb09ff378b554)。该次结果记录于 `deployments/sepolia-smoke.json`，当前余额以链上查询为准。

## 1. 准备部署钱包与测试 ETH

使用独立测试钱包，在 Sepolia 网络通过 faucet 申请测试 ETH。faucet 可能要求登录、限制频次或暂时不可用，请以实际到账为准。测试 ETH 用于部署和交易 gas，不需要购买真实 ETH，也不能把本地 Hardhat ETH 转到 Sepolia。

本机已经为独立部署钱包创建密钥文件 `C:\Users\Lenovo\.sqc-secrets\sepolia-deployer.key`，文件位于项目之外。部署钱包公开地址为 **`0xFD46DCbb7F3FA990B128d780066EA18Bf261a749`**；已确认收到 0.05 个 Sepolia 测试 ETH。部署及后续交易会消耗测试 gas，当前余额以链上查询为准。

私钥不进入 GitHub，不要把私钥贴到聊天或网页，也不要把密钥文件放进 `docs/` 或版本库。公共配置只包含网络、合约地址、ABI 等公开参数；其他用户交互时由浏览器中各自的个人钱包签名，不使用这个部署私钥。

没有测试 ETH 时，部署缺口仍然存在，先执行第 3 步导出准备中网页即可。公共站点不能为此使用内置开发账户或伪造 Sepolia 余额。

## 2. 部署 Sepolia 合约

本机需要 Node.js 22.10 或更新版本及项目依赖。使用 PowerShell：

```powershell
cd S:\xingyuan-token
$env:SEPOLIA_RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com'
$env:DEPLOYER_KEY_FILE = 'C:\Users\Lenovo\.sqc-secrets\sepolia-deployer.key'
Remove-Item Env:SEPOLIA_PROFILE -ErrorAction SilentlyContinue
npm.cmd run deploy:testnet
```

默认部署 `public-demo`，使用 **12 bits / 60 秒**。如果选择较慢的测试节奏，在执行部署命令前设置：

```powershell
$env:SEPOLIA_PROFILE = 'bitcoin-paced'
```

这会使用 **24 bits / 600 秒**。两种预设都初始奖励 50 SQC，每 210,000 次成功申领减半，精度 8 位；现有合约参数不能修改。

脚本只接受 Sepolia（链 ID `11155111`），从本机文件读取私钥且不打印私钥。默认交易前费用预算为 0.02 个 Sepolia 测试 ETH，可通过 `SEPOLIA_MAX_FEE_ETH` 调整；费用估算超过预算或余额时不发送交易。

部署交易确认后，`deployments/sepolia.json` 保存合约地址、部署交易及公开元数据，不包含秘密；脚本随后自动导出公共网页。检查该文件与 [Sepolia Etherscan](https://sepolia.etherscan.io/) 的实际交易记录，再进入下一步。

如果部署已经确认但自动导出因公共 RPC 不可用而失败，部署仍然存在。先核对记录和链上交易，恢复连接后执行 `npm.cmd run export:public`，避免直接重复部署。没有确认的部署结果时不要把网页状态标成已部署。

## 3. 导出与预览

```powershell
cd S:\xingyuan-token
npm.cmd run export:public
npm.cmd run preview:public
```

在 <http://127.0.0.1:8789> 打开预览。导出脚本生成 `docs/` 静态网页及 `docs/api/config.json`；有部署记录时先通过公共 RPC 确认网络和合约代码，再生成对应实例配置，没有部署记录时显示准备中。重新部署或改用另一个实例后，必须重新导出。

公共网页使用 `https://ethereum-sepolia-rpc.publicnode.com` 读取链上数据。导出不打包 `runtime/`、完整 `node_modules/` 或私钥文件；浏览器所需依赖作为静态资源提供，公共配置只有网络、合约与 ABI 等公开信息。

检查显示的名称为 Soul Quant Coin、简称 SQC，网络为 Sepolia。待部署页面应显示准备中并关闭挖矿与转账；已部署页面应显示与部署记录一致的合约地址及链上状态。

## 4. 推送 GitHub 并设置 Pages

将源码、文档和生成的 `docs/` 提交到 `Dryoung95/soul-quant-coin` 的 `main` 分支。提交前检查改动列表，密钥文件、带私人凭据的 `.env` 文件、本地 `runtime/` 和 `node_modules/` 不应进入仓库。`deployments/sepolia.json` 不含私钥，可以提交用于说明对应实例。

在 GitHub 仓库中打开 **Settings → Pages**：

1. Source 选择 **Deploy from a branch**。
2. Branch 选择 **main**，Folder 选择 **/docs**。
3. 保存，并等待 Pages 发布结果。
4. 打开 GitHub 给出的实际网址，检查加载的版本和部署状态。

之后更新合约配置或界面时，重新运行 `npm.cmd run export:public`，提交并推送更新后的 `docs/`。GitHub Pages 仅托管静态资源，不运行 Hardhat、本机 RPC 或私钥签名服务。

## 5. 使用公共钱包

桌面浏览器使用 MetaMask，手机使用 **MetaMask App 内置浏览器**访问公共网址。普通手机浏览器可以查看页面及链上状态；当前实现需要注入钱包才能交易。

连接自己的钱包并切换 Sepolia，领取少量 faucet 测试 ETH 支付 gas。挖矿先在浏览器计算解，再由 MetaMask 确认提交；转账同样需要钱包确认。收款者不需要给网页提供私钥。

| Sepolia 钱包设置 | 值 |
|---|---|
| 网络 | Sepolia |
| 链 ID | `11155111` |
| 公共 RPC | `https://ethereum-sepolia-rpc.publicnode.com` |
| gas 货币 | Sepolia ETH |
| SQC 合约 | `0x246296fCAa195069d69DbF04778600Dac31A0dB0` |
| 代币符号 / 精度 | `SQC` / `8` |
| 区块浏览器 | `https://sepolia.etherscan.io` |

SQC 仅供实验，没有价格、兑付或投资回报承诺。公共模式直接读取 Sepolia 数据，链上历史不依赖这台电脑保持开机；公共 RPC 连接失败时需要恢复网络连接，不能用本地快照代替真实链状态。

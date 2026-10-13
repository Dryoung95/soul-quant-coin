# Soul Quant Coin（SQC）

Soul Quant Coin（SQC）是一枚参考比特币发行规则设计的 ERC-20 测试代币。项目提供本地 Hardhat 实验室，并支持把钱包网页发布到 GitHub Pages，连接 Sepolia 公共测试网。网页用于查看链上状态、计算挖矿解和发起转账，交易由用户自己的 MetaMask 签名。

**SQC 和测试 ETH 只供实验，不代表真实资产或兑换承诺。开发账户只用于本地实验，不要转入真实资产。** 公共网页发布与合约部署是两个步骤：没有完成 Sepolia 部署时，公共页显示“准备中”，不能挖矿或转账。是否已有公共合约，以成功生成的 `deployments/sepolia.json` 及链上交易为准。

## 公共测试网钱包

仓库 [Dryoung95/soul-quant-coin](https://github.com/Dryoung95/soul-quant-coin) 已创建，GitHub Pages 目标地址为 <https://dryoung95.github.io/soul-quant-coin/>。发布步骤见 [PUBLIC_DEPLOYMENT.md](PUBLIC_DEPLOYMENT.md)；仓库存在不代表 Pages 或 Sepolia 合约已经上线。当前部署钱包尚无 Sepolia 测试 ETH，合约部署待完成。

部署完成后，桌面浏览器安装 MetaMask 并连接 Sepolia，可以用自己的钱包挖矿、转账和接收 SQC。钱包需要少量 **Sepolia 测试 ETH** 支付交易 gas；SQC 本身不能支付 gas。

普通手机浏览器可以查看公共页面及已部署合约状态；需要交易时，在 **MetaMask App 内置浏览器**中打开同一网址。当前页面依赖注入钱包，不提供普通手机浏览器的 WalletConnect 会话。

公网模式不使用本地开发账户。私钥留在用户钱包里，GitHub Pages 不接收或保存私钥。数据来自 Sepolia RPC，不是本地余额快照；关闭本机实验室不会清空已经确认的 Sepolia 记录。

导出并在本机预览公共网页：

```powershell
cd S:\xingyuan-token
npm.cmd run export:public
npm.cmd run preview:public
```

预览地址为 <http://127.0.0.1:8789>。导出内容保存在 `docs/`，使用公共 RPC `https://ethereum-sepolia-rpc.publicnode.com`。没有部署记录时也可以生成“准备中”的页面；部署成功后需要重新导出，再发布更新后的文件。

## 启动本地实验室

在 `S:\xingyuan-token` 中双击 `Start-Lab.cmd`，按启动窗口提示打开网页。也可以在该目录运行：

```powershell
cd S:\xingyuan-token
npm.cmd start
```

默认网页为 <http://127.0.0.1:8787>，链 RPC 为 <http://127.0.0.1:8545>。启动过程会编译合约、启动本地链并部署新的 Soul Quant Coin 实例；首次打开页面时供应量为零。运行期间保留启动进程。`npm.cmd start` 在 Windows 上执行的就是 `npm start`。

本机已安装 Node.js 24；启动器使用系统 Node.js，要求 22.10 或更新版本，没有内置运行时替代方案。当前工程依赖已安装；如果 `node_modules` 不存在，双击启动器会先安装依赖。复制到另一台电脑时需要安装符合版本要求的 Node.js，再执行 `npm.cmd install` 和 `npm.cmd start`。

前台运行时，在启动窗口按 `Ctrl+C` 停止。后台运行或启动窗口不可见时，在项目目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\Stop-Lab.ps1
```

本地运行信息保存在 `runtime/config.json`（当前合约与网页配置）、`runtime/process.json`（本次进程记录）及 `runtime/chain.log`（链日志）。这些文件不是账本备份，重启时会更新。

**重新启动实验室会创建一条新链，之前的 SQC 余额、挖矿进度和交易记录会清空。** 若 MetaMask 保留了上次实验的交易状态，重新连接当前链，必要时清理该本地测试网络的账户活动记录。请以当前页面显示的合约地址和余额为准。

## 账户与挖矿

1. 打开页面后先使用内置开发账户，账户选择器可以切换不同测试地址。这些账户由本地节点解锁，并预置了用于支付本地 gas 的测试 ETH。
2. 查看当前奖励、全局下一次可挖时间及钱包地址，开始挖矿。浏览器尝试 nonce，找到符合条件的解后向合约提交交易。
3. 等待交易确认，余额中会出现当前轮次的 SQC 奖励。可以取消浏览器计算；已提交的链上交易不能通过取消计算撤回。
4. 切换账户或网络后，重新读取当前状态再挖矿。其他账户成功申领会使旧轮次的解失效，需要重新计算。

默认初始奖励为 **50 SQC**，每 **210,000 次成功申领**减半。全局两次成功申领至少相隔 **10 秒**，不是每个账户分别计时。挖矿不会自动发送给所有账户，奖励只属于提交有效解的地址。

## 转账

切换到有 SQC 的账户，填写接收地址和金额后提交转账。SQC 最多有 **8 位小数**，金额必须大于零且不超过余额；发送账户也需要所在测试链的 ETH 支付 gas。合约没有交易税，收款地址收到填写的完整 SQC 数量。

最近交易记录包括铸币和转账。铸币记录的来源是零地址；普通转账只改变持有者，不增加发行总量。请在确认前核对完整收款地址。

## MetaMask 本地链

内置开发账户已经可以完成整个演示。若要体验扩展钱包授权，可以在页面连接 MetaMask，按提示添加或切换本地网络，再导入 SQC。

| 设置 | 值 |
|---|---|
| 网络名称 | Soul Quant Coin 本地实验室 |
| RPC URL | `http://127.0.0.1:8545` |
| 链 ID | `31337` |
| 原生货币符号 | `ETH` |
| 区块浏览器 | 留空 |
| SQC 合约地址 | 使用当前页面显示的地址 |
| 代币符号 / 精度 | `SQC` / `8` |

SQC 是代币，不是 gas 货币。使用自己的 MetaMask 地址时，需要先在**本地链**获得测试 ETH。下面的 PowerShell 示例从第一个已解锁开发账户发送 0.1 个本地 ETH；先把接收地址替换成你的 MetaMask 地址：

```powershell
$sqcRpcUrl = 'http://127.0.0.1:8545'
$sqcRecipient = '替换为你的完整0x钱包地址'
$sqcAccounts = Invoke-RestMethod -Uri $sqcRpcUrl -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"eth_accounts","params":[]}'
$sqcRequest = @{
    jsonrpc = '2.0'
    id = 2
    method = 'eth_sendTransaction'
    params = @(@{
        from = $sqcAccounts.result[0]
        to = $sqcRecipient
        value = '0x16345785d8a0000'
    })
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri $sqcRpcUrl -Method Post -ContentType 'application/json' -Body $sqcRequest
```

请只对上面的本地 RPC 使用此示例。开发账户和开发私钥不能用于真实资产；自己的钱包私钥也不需要交给本地网页或聊天。

## 发行参数

| 项目 | 设置 |
|---|---|
| 完整名称 / 链上名称 | Soul Quant Coin |
| 简称 / 精度 | SQC / 8 位小数 |
| 创世供应量 | 0 |
| 供应硬上限 | 21,000,000 SQC |
| 初始挖矿奖励 | 50 SQC |
| 减半周期 | 每 210,000 次成功申领 |
| 按整数奖励曲线最大可挖量 | 20,999,999.9769 SQC |
| 管理员 / 额外增发 / 交易税 | 无 |

硬上限不等于最终一定发行的数量。奖励以最小单位向下取整，经过 33 个有奖励阶段后变为零，因此实际最大可挖量略小于 2,100 万。挖矿结束后仍可转账。

项目使用以下测试参数预设：

| 预设 | 全局最短申领间隔 | PoW 难度位数 | 用途 |
|---|---:|---:|---|
| `local-fast` | 10 秒 | 12 | 默认本机交互演示 |
| `public-demo` | 60 秒 | 12 | Sepolia 默认公共钱包演示 |
| `bitcoin-paced` | 600 秒 | 24 | 更慢节奏的测试实验 |

这些预设都保留 210,000 次减半周期。`bitcoin-paced` 也是测试配置，不代表满足比特币安全性或适合直接上线主网。PoW 仅决定谁可以申领合约奖励，底层链共识仍由 Ethereum 测试环境负责。详细规则见 [DESIGN.md](DESIGN.md)。

先停止当前实验室，再用下面的命令启动较慢预设；这会创建新链：

```powershell
npm.cmd start -- --bitcoin-paced
```

## 部署到 Sepolia

要生成公共测试网实例，需要准备可用的 Sepolia RPC URL、独立测试部署钱包，以及支付 gas 所需的 Sepolia 测试 ETH。可以通过 Sepolia faucet 为测试钱包申请测试 ETH，是否到账取决于 faucet 规则和实际处理结果。项目不会从本地余额生成 Sepolia 余额，也不会自动获得这些资源。

部署脚本使用**本机密钥文件**，不要求把私钥粘贴到聊天。把部署钱包私钥保存在项目目录之外、仅你可以读取的文本文件中；文件内容是一行部署私钥。不要把这个文件提交到版本库。

Sepolia 默认使用 `public-demo`，即 **60 秒 / 12 bits**，链 ID 为 `11155111`。如需较慢预设，在部署前设置 `$env:SEPOLIA_PROFILE = 'bitcoin-paced'`，使用 **600 秒 / 24 bits**。部署后的参数不可修改；更换参数需要部署新实例。

部署脚本先检查网络、余额和估算费用；默认费用预算上限是 **0.02 个 Sepolia 测试 ETH**，这是交易前检查的预算，并非固定收费。估算费用超过预算或钱包余额时不会发送交易。需要调整预算时，可以设置 `SEPOLIA_MAX_FEE_ETH`，单位为测试 ETH。

在 PowerShell 设置以下变量，路径和 RPC 替换为自己的实际值：

```powershell
cd S:\xingyuan-token
$env:SEPOLIA_RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com'
$env:DEPLOYER_KEY_FILE = 'C:\Users\Lenovo\.sqc-secrets\sepolia-deployer.key'
Remove-Item Env:SEPOLIA_PROFILE -ErrorAction SilentlyContinue
npm.cmd run deploy:testnet
```

脚本从密钥文件读取私钥，不打印私钥。成功部署后，合约地址及部署信息保存在 `deployments/sepolia.json`，其中不包含私钥；脚本随后自动导出公共网页。也可重新运行 `npm.cmd run export:public` 更新 `docs/`，再提交到 GitHub。若交易已确认、部署记录已生成，但公共 RPC 暂时不可用导致导出失败，应先核对部署记录及链上交易，恢复 RPC 后重试导出，避免直接重复部署。

## 本地验证

```powershell
npm.cmd run compile
npm.cmd test
```

这些命令用于编译与自动化验证；本说明本身不代表某次测试结果或公开测试网部署已经成功。运行记录与部署结果应以本机实际命令输出为准。

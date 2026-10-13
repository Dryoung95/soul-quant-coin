# Soul Quant Coin SQC 实现约定

本地 Ethereum 测试链，chainId 31337，RPC http://127.0.0.1:8545；前端 http://127.0.0.1:8787。
名称 Soul Quant Coin，中文Soul Quant Coin，简称 SQC，8 decimals，MAX_SUPPLY=21000000*10^8。
创世零发行，无 owner、无额外增发、无交易税。初始奖励50 SQC，每210000次成功申领减半。
本地实例每次成功申领至少间隔10秒，difficultyBits=12，正式节奏预设600秒/24 bits；正式节奏也只供测试，不是主网上线建议。
实际整数发行曲线最大可挖20999999.9769 SQC。合约PoW仅决定代币奖励，底层Ethereum负责共识。

## 合约接口

标准ERC20；MAX_SUPPLY()、INITIAL_REWARD()、HALVING_INTERVAL()、difficultyBits()、minimumInterval()、miningRound()、challenge()、nextMiningAt()、currentReward()、miningTarget()、rewardAt(uint256 round)。
mine(uint256 expectedRound,uint256 nonce)；event Mined(address indexed miner,uint256 indexed round,uint256 reward,uint256 nonce,bytes32 digest)。
哈希 ethers.solidityPackedKeccak256(['uint256','address','uint256','bytes32','address','uint256'],[chainId,contractAddress,round,challenge,miner,nonce])；uint256(digest)<=miningTarget() 才有效。
expectedRound使用0起始轮次；每次成功更新challenge和轮次。等待nextMiningAt才提交。挖矿可在浏览器执行，分批让出UI线程，可取消。用户切换账户/链时停止当前挖矿并刷新。

## HTTP 和前端

GET /api/config 返回 {chainId:31337,rpcUrl:'http://127.0.0.1:8545',name:'Soul Quant Coin',symbol:'SQC',address,abi,profile:'local-fast',miningInterval:10,difficultyBits:12}。
GET /vendor/ethers.js 提供ethers UMD。web目录静态文件；没有私钥HTTP接口。
前端可用 ethers.JsonRpcProvider(config.rpcUrl) 查看状态，provider.listAccounts() 得到已解锁开发账户JsonRpcSigner，默认第一个，支持账户切换。明确开发账户仅本地测试。
支持MetaMask/injected钱包连接、添加/切换本地31337链、导入代币。钱包拒绝操作需友好报错。
转账ERC20 transfer，显示精度/余额错误；最近Transfer事件（含铸币）和交易hash；链状态、账户地址、余额、已发行/上限、奖励、轮次、下次减半倒数、全局下次可挖时间。
UI全中文，精致清晰，浅底配深侧栏/青绿强调色；明显本地测试徽标和无市场价值说明。发行曲线/减半说明放说明区域。
无需第三方CDN。内部参数属于实验室信息页，普通转账页聚焦收款地址、金额、钱包。

## 工程所有权

父代理负责contracts、scripts、tests、配置和依赖。UI代理只负责web目录。文档代理只负责README.md、DESIGN.md。多人共享目录，不回退他人改动。

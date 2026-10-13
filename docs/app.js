(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = {
    config: null, provider: null, token: null, browserProvider: null,
    mode: 'dev', signer: null, address: null, accounts: [], epoch: 0,
    online: false, busyTransfer: false, resolvingWallet: false,
    refreshBusy: false, refreshAgain: false, data: null, events: [],
    balance: 0n, nativeBalance: 0n, mining: null, toastTimer: null,
  };
  const ZERO = '0x0000000000000000000000000000000000000000';
  const pageNames = { wallet: '我的钱包', mining: '挖矿实验', ledger: '链上流水', info: '发行与机制' };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const short = (value, start = 6, end = 4) => value ? `${value.slice(0, start)}…${value.slice(-end)}` : '—';
  const number = (value) => Number(value).toLocaleString('zh-CN');
  const sameAddress = (a, b) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
  const isPublic = () => state.config?.publicTestnet === true;
  const isPending = () => !state.config?.address || state.config?.deploymentPending === true;
  const networkName = () => isPublic() ? 'Sepolia 测试网' : '本地测试链';
  const fmt = (value, decimals = 8) => {
    const parts = ethers.formatUnits(value, decimals).split('.');
    const whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const fraction = (parts[1] || '').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole;
  };
  const message = (element, text, tone = '') => {
    element.textContent = text;
    element.classList.remove('error', 'pending');
    if (tone) element.classList.add(tone);
    element.hidden = !text;
  };
  function friendlyError(error) {
    if (error?.code === 'STALE_ACCOUNT') return '账户或网络已经改变，请使用当前账户重新操作。';
    if (error?.code === 'ACTION_REJECTED' || error?.code === 4001 || error?.info?.error?.code === 4001) return '你取消了钱包操作，可以随时重试。';
    if (error?.code === -32002 || error?.info?.error?.code === -32002) return '钱包中已有待处理的连接请求，请先在钱包内处理。';
    const reason = error?.revert?.name || error?.reason || error?.shortMessage || error?.message || '';
    if (/insufficient funds/i.test(reason)) return isPublic() ? 'Sepolia ETH 不足，无法支付手续费。请使用测试 ETH 领取入口补充后重试。' : '测试 ETH 不足，无法支付手续费。请切换到有测试 ETH 的开发账户。';
    if (/Round|round|Challenge|challenge/i.test(reason)) return '本轮挑战已更新，其他账户可能已先完成挖矿。请重新开始。';
    if (/TooEarly|too early|interval|cooldown/i.test(reason)) return '尚未达到全网下一次申领时间，请稍后重新挖矿。';
    if (/InvalidProof|invalid proof/i.test(reason)) return '当前计算结果未被合约接受，请刷新状态后重试。';
    if (/Exhausted|NoReward|MiningEnded|Supply/i.test(reason)) return '本轮可发行奖励已耗尽，无法继续申领。';
    if (/ERC20InsufficientBalance|exceeds balance/i.test(reason)) return 'SQC 余额不足，请刷新余额后调整数量。';
    if (/network changed|NETWORK_ERROR/i.test(reason)) return `钱包网络发生变化，请切换到${networkName()}后重新操作。`;
    if (/fetch|connect|ECONNREFUSED|failed to detect network|could not coalesce/i.test(reason)) return isPublic() ? 'Sepolia 节点暂时无法连接，请检查网络后刷新。' : '暂时无法连接本地节点。请确认实验室启动程序仍在运行，然后重新连接。';
    return reason && reason.length < 200 ? `操作未完成：${reason}` : '操作未完成，请检查网络与钱包状态后重试。';
  }
  function toast(text) {
    clearTimeout(state.toastTimer);
    $('toast').textContent = text;
    $('toast').hidden = false;
    state.toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3200);
  }
  async function copy(value) {
    if (!value) return;
    try { await navigator.clipboard.writeText(value); toast('已复制到剪贴板'); }
    catch { toast('浏览器不允许复制，请选中完整地址后手动复制。'); }
  }
  function staleError() {
    const error = new Error('账户或网络已变化');
    error.code = 'STALE_ACCOUNT';
    return error;
  }
  function snapshot() {
    return { epoch: state.epoch, mode: state.mode, address: state.address, signer: state.signer };
  }
  function current(snap) {
    return snap.epoch === state.epoch && snap.mode === state.mode && sameAddress(snap.address, state.address) && snap.signer === state.signer;
  }
  async function assertSigner(snap) {
    if (isPending()) throw new Error('Sepolia 合约尚未部署，暂不能转账或申领奖励。');
    if (!snap.signer || !current(snap)) throw staleError();
    const address = await snap.signer.getAddress();
    if (!current(snap) || !sameAddress(address, snap.address)) throw staleError();
    if (snap.mode === 'wallet') {
      const [chain, accounts] = await Promise.all([
        window.ethereum.request({ method: 'eth_chainId' }),
        window.ethereum.request({ method: 'eth_accounts' }),
      ]);
      if (!current(snap) || BigInt(chain) !== BigInt(state.config.chainId) || !sameAddress(accounts[0], snap.address)) throw staleError();
    } else {
      const network = await state.provider.getNetwork();
      if (!current(snap) || network.chainId !== BigInt(state.config.chainId)) throw staleError();
    }
  }
  async function prepareTransaction(snap, method, args) {
    if (isPending()) throw new Error('Sepolia 合约尚未部署，暂不能转账或申领奖励。');
    if (!current(snap)) throw staleError();
    const token = new ethers.Contract(state.config.address, state.config.abi, snap.signer);
    const transaction = await token[method].populateTransaction(...args);
    if (!current(snap)) throw staleError();
    // 固定 gas 上限让本地挖矿申领避开旧块 timestamp 上的预估调用。
    // 合约实际消耗的 gas 才会计费，申领间隔仍由合约检查。
    const gas = method === 'mine' ? 350000n : await state.provider.estimateGas({ ...transaction, from: snap.address });
    if (!current(snap)) throw staleError();
    return {
      from: snap.address, to: state.config.address, data: transaction.data,
      gas: ethers.toQuantity(gas), chainId: ethers.toQuantity(state.config.chainId),
    };
  }
  async function broadcast(snap, request) {
    if (isPending()) throw new Error('Sepolia 合约尚未部署，暂不能转账或申领奖励。');
    // 所有预估、钱包状态读取完成后立即提交，中间不再异步填充旧 signer 的交易。
    if (!current(snap)) throw staleError();
    if (snap.mode === 'wallet') return window.ethereum.request({ method: 'eth_sendTransaction', params: [request] });
    if (isPublic()) throw new Error('公共测试网交易必须由个人钱包签名。');
    const response = await fetch(state.config.rpcUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'eth_sendTransaction', params: [request] }),
    });
    if (!response.ok) throw new Error('本地节点暂时无法接受交易，请重新连接后重试。');
    const result = await response.json();
    if (result.error) {
      const error = new Error(result.error.message || '本地节点拒绝了交易。');
      error.code = result.error.code;
      throw error;
    }
    if (!result.result) throw new Error('本地节点未返回交易哈希。');
    return result.result;
  }
  function updateActions() {
    const pending = isPending();
    const ready = Boolean(!pending && state.online && state.token && state.signer && state.address && !state.resolvingWallet);
    $('send-button').disabled = !ready || state.busyTransfer || Boolean(state.mining);
    $('start-mining').disabled = !ready || state.busyTransfer || Boolean(state.mining) || !state.data || state.data.reward === 0n;
    $('stop-mining').disabled = !state.mining || state.mining.submitting;
    $('use-dev').disabled = isPublic() || !state.config || state.resolvingWallet;
    $('connect-wallet').disabled = !state.config || state.resolvingWallet;
    $('account-select').disabled = state.mode !== 'dev' || !state.accounts.length;
    $('max-amount').disabled = !ready || state.busyTransfer;
    $('copy-address').disabled = !state.address;
    $('watch-token').disabled = pending || !state.config || !window.ethereum;
    $('switch-chain').disabled = !state.config || !window.ethereum;
    $('recipient').disabled = pending;
    $('amount').disabled = pending;
    $('send-button').querySelector('span').textContent = pending ? '等待合约部署' : state.busyTransfer ? '等待交易确认…' : '发送 SQC';
    if (!state.mining) $('start-mining').querySelector('span').textContent = pending ? '等待合约部署' : '开始挖矿';
  }
  function renderAccount() {
    $('active-address').textContent = state.address || '尚未连接';
    $('mining-account').textContent = state.address || '尚未连接';
    $('account-type').textContent = state.mode === 'dev' ? '开发账户' : '个人钱包';
    $('account-label').textContent = state.mode === 'dev' ? '选择一个测试账户' : '钱包账户（在钱包内切换）';
    $('use-dev').classList.toggle('selected', state.mode === 'dev');
    $('connect-wallet').classList.toggle('selected', state.mode === 'wallet');
    $('connect-wallet').textContent = state.resolvingWallet ? '连接中…' : state.mode === 'wallet' && state.address ? '钱包已连接' : '连接钱包';
    const select = $('account-select');
    select.replaceChildren();
    if (state.mode === 'dev' && state.accounts.length) {
      state.accounts.forEach((account, index) => {
        const option = new Option(`开发账户 ${String(index + 1).padStart(2, '0')} · ${short(account.address, 8, 6)}`, account.address);
        option.selected = sameAddress(account.address, state.address);
        select.add(option);
      });
    } else select.add(new Option(state.address ? short(state.address, 13, 10) : state.mode === 'wallet' ? '等待钱包连接' : '没有可用的开发账户', ''));
    $('balance-main').replaceChildren(document.createTextNode(state.address && state.online && state.token ? fmt(state.balance) : '—'));
    const unit = document.createElement('span'); unit.textContent = ' SQC'; $('balance-main').append(unit);
    $('balance-subtitle').textContent = isPublic() && isPending() ? 'Sepolia 合约部署准备中，尚无 SQC 余额' : state.address ? `${state.mode === 'dev' ? '本地开发账户' : '已连接个人钱包'} · ${short(state.address, 9, 7)}` : '连接账户后显示链上余额';
    $('native-balance').textContent = state.address && state.online ? `${Number(ethers.formatUnits(state.nativeBalance, 18)).toLocaleString('zh-CN', { maximumFractionDigits: 6 })} ETH` : '—';
    $('native-balance').title = state.address ? `${ethers.formatUnits(state.nativeBalance, 18)} ETH` : '';
    updateActions();
    renderEvents();
  }
  function invalidateAccount() {
    state.epoch += 1;
    state.signer = null;
    state.address = null;
    state.balance = 0n;
    state.nativeBalance = 0n;
    stopMining('账户或网络已改变，已停止本轮计算。');
    if (state.mining?.submitting) message($('mining-feedback'), '账户或网络已改变。原账户已发起的申领仍在处理中，请等待确认。', 'pending');
    message($('transfer-feedback'), state.busyTransfer ? '账户或网络已改变。原账户已发起的转账仍在处理中，请等待确认。' : '', state.busyTransfer ? 'pending' : '');
    renderAccount();
    return state.epoch;
  }
  async function useDev(address) {
    if (isPublic()) return;
    const epoch = invalidateAccount();
    state.mode = 'dev';
    state.resolvingWallet = true;
    message($('wallet-message'), '');
    renderAccount();
    try {
      const accounts = await state.provider.listAccounts();
      if (epoch !== state.epoch || state.mode !== 'dev') return;
      state.accounts = await Promise.all(accounts.map(async (signer) => ({ signer, address: await signer.getAddress() })));
      if (epoch !== state.epoch || state.mode !== 'dev') return;
      const selected = state.accounts.find((entry) => sameAddress(entry.address, address)) || state.accounts[0];
      if (!selected) throw new Error('本地节点没有已解锁的开发账户。');
      state.signer = selected.signer;
      state.address = selected.address;
    } catch (error) {
      if (epoch === state.epoch) message($('wallet-message'), friendlyError(error), 'error');
    } finally {
      if (epoch === state.epoch) {
        state.resolvingWallet = false;
        renderAccount();
        await refresh();
      }
    }
  }
  async function connectWallet(requestAccess = true) {
    if (!window.ethereum) { message($('wallet-message'), isPublic() ? '在手机上，请使用 MetaMask App 内置浏览器打开此页面；电脑可使用已有的钱包扩展。' : '未检测到浏览器钱包。可安装 MetaMask，或直接使用本地开发账户。', 'error'); return; }
    const epoch = invalidateAccount();
    state.mode = 'wallet';
    state.resolvingWallet = true;
    message($('wallet-message'), '');
    renderAccount();
    try {
      const accounts = await window.ethereum.request({ method: requestAccess ? 'eth_requestAccounts' : 'eth_accounts' });
      const chain = await window.ethereum.request({ method: 'eth_chainId' });
      if (epoch !== state.epoch || state.mode !== 'wallet') return;
      if (!accounts.length) { message($('wallet-message'), '点击“连接钱包”授权个人账户。手机请在 MetaMask App 内置浏览器打开。'); return; }
      state.address = accounts[0];
      if (BigInt(chain) !== BigInt(state.config.chainId)) {
        message($('wallet-message'), `钱包当前网络不匹配。点击“添加 / 切换${isPublic() ? ' Sepolia' : '本地链'}”后即可连接。`, 'error');
        return;
      }
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const signer = await browserProvider.getSigner(accounts[0]);
      const address = await signer.getAddress();
      if (epoch !== state.epoch || state.mode !== 'wallet') return;
      state.browserProvider = browserProvider;
      state.signer = signer;
      state.address = address;
      message($('wallet-message'), isPublic() ? isPending() ? '个人钱包已连接。合约部署准备中，挖矿与转账暂不可用。' : '个人钱包已连接。挖矿与转账由你在钱包中签名，手续费使用 Sepolia ETH。' : '钱包已连接。本地开发账户的 ETH 与 SQC 可转入此地址供测试。');
    } catch (error) {
      if (epoch === state.epoch) message($('wallet-message'), friendlyError(error), 'error');
    } finally {
      if (epoch === state.epoch) {
        state.resolvingWallet = false;
        renderAccount();
        await refresh();
      }
    }
  }
  async function switchChain() {
    if (!window.ethereum || !state.config) return;
    const chainId = ethers.toQuantity(state.config.chainId);
    try {
      try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] }); }
      catch (error) {
        if (error.code !== 4902 && error?.data?.originalError?.code !== 4902) throw error;
        await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId, chainName: isPublic() ? 'Sepolia' : 'Soul Quant Coin · 本地测试链', nativeCurrency: { name: isPublic() ? 'Sepolia Ether' : '测试 Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [state.config.rpcUrl], ...(isPublic() ? { blockExplorerUrls: ['https://sepolia.etherscan.io'] } : {}) }] });
        await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
      }
      toast(`已切换到${networkName()}`);
      if (state.mode === 'wallet') await connectWallet(false);
    } catch (error) { message($('wallet-message'), friendlyError(error), 'error'); }
  }
  async function watchToken() {
    if (!window.ethereum || !state.config || isPending()) return;
    try {
      const chain = await window.ethereum.request({ method: 'eth_chainId' });
      if (BigInt(chain) !== BigInt(state.config.chainId)) { message($('wallet-message'), `请先添加 / 切换${isPublic() ? ' Sepolia' : '本地链'}，再导入 SQC。`, 'error'); return; }
      const added = await window.ethereum.request({ method: 'wallet_watchAsset', params: { type: 'ERC20', options: { address: state.config.address, symbol: state.config.symbol, decimals: 8 } } });
      toast(added ? 'SQC 已添加到钱包' : '已取消导入代币');
    } catch (error) { message($('wallet-message'), friendlyError(error), 'error'); }
  }
  function online(value) {
    state.online = value;
    $('connection-pill').classList.toggle('offline', !value);
    $('connection-text').textContent = value ? `${networkName()}已连接` : `${networkName()}暂未连接`;
    updateActions();
  }
  function renderData() {
    const data = state.data;
    if (!data) return;
    const reward = fmt(data.reward);
    ['reward-wallet', 'reward-mining', 'reward-metric'].forEach((id) => { $(id).textContent = reward; });
    ['round-wallet', 'round-mining'].forEach((id) => { $(id).textContent = number(data.round); });
    $('supply-wallet').textContent = fmt(data.supply);
    const percent = Number(data.supply * 1000000n / data.maxSupply) / 10000;
    $('supply-progress').style.width = `${Math.min(100, percent)}%`;
    $('supply-percent').textContent = `${percent.toLocaleString('zh-CN', { maximumFractionDigits: 4 })}% 已发行`;
    $('halving-countdown').textContent = number(data.halving - data.round % data.halving);
    $('config-interval').textContent = `${number(data.interval)} 秒`;
    $('config-difficulty').textContent = `${number(data.difficulty)} bits`;
    updateCountdown();
    updateActions();
  }
  function chainNow() {
    const wallTime = Math.floor(Date.now() / 1000);
    return state.data ? Math.max(state.data.blockTime + Math.floor((Date.now() - state.data.fetchedAt) / 1000), wallTime) : wallTime;
  }
  function updateCountdown() {
    if (!state.data) return;
    const remain = Math.max(0, Number(state.data.nextMiningAt) - chainNow());
    $('next-mining').textContent = remain ? `${remain} 秒后` : '现在可挖';
    $('next-mining').title = `合约规定的下次申领时间：${new Date(Number(state.data.nextMiningAt) * 1000).toLocaleString('zh-CN')}`;
  }
  async function recentTransfers(blockNumber) {
    const deployBlock = isPublic() ? Number(state.config.deploymentBlock || 0) : 0;
    const first = Math.max(deployBlock, blockNumber - 4999, 0);
    const events = [];
    // 公共 RPC 常限制单次日志区块范围；这里只读取最近最多 5,000 块。
    for (let start = first; start <= blockNumber; start += 2500) {
      const batch = await state.token.queryFilter(state.token.filters.Transfer(), start, Math.min(start + 2499, blockNumber));
      events.push(...batch);
    }
    return events.slice(-80).reverse();
  }
  async function refresh() {
    if (!state.provider) return;
    if (state.refreshBusy) { state.refreshAgain = true; return; }
    state.refreshBusy = true;
    const epoch = state.epoch;
    const address = state.address;
    $('refresh-button').classList.add('loading');
    try {
      if (!state.token) {
        const [network, block, nativeBalance] = await Promise.all([
          state.provider.getNetwork(), state.provider.getBlock('latest'),
          address ? state.provider.getBalance(address) : Promise.resolve(0n),
        ]);
        if (epoch !== state.epoch) { state.refreshAgain = true; return; }
        if (network.chainId !== BigInt(state.config.chainId)) throw new Error('RPC 的 Chain ID 与当前配置不一致。');
        state.nativeBalance = nativeBalance;
        online(true);
        $('connection-error').hidden = true;
        $('last-update').textContent = `Sepolia 部署准备中 · 区块 ${number(block.number)}`;
        renderAccount();
        return;
      }
      const [network, block, supply, maxSupply, reward, round, challenge, nextMiningAt, target, halving, interval, difficulty, balance, nativeBalance] = await Promise.all([
        state.provider.getNetwork(), state.provider.getBlock('latest'),
        state.token.totalSupply(), state.token.MAX_SUPPLY(), state.token.currentReward(), state.token.miningRound(), state.token.challenge(), state.token.nextMiningAt(), state.token.miningTarget(), state.token.HALVING_INTERVAL(), state.token.minimumInterval(), state.token.difficultyBits(),
        address ? state.token.balanceOf(address) : Promise.resolve(0n),
        address ? state.provider.getBalance(address) : Promise.resolve(0n),
      ]);
      if (network.chainId !== BigInt(state.config.chainId)) throw new Error('RPC 的 Chain ID 与实验室配置不一致。');
      if (!block) throw new Error('测试链尚无可读取区块。');
      if (epoch !== state.epoch) { state.refreshAgain = true; return; }
      state.data = { supply, maxSupply, reward, round, challenge, nextMiningAt, target, halving, interval, difficulty, blockTime: block.timestamp, fetchedAt: Date.now() };
      state.balance = balance;
      state.nativeBalance = nativeBalance;
      online(true);
      $('connection-error').hidden = true;
      $('last-update').textContent = `同步于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} · 区块 ${number(block.number)}`;
      if (state.mining && !state.mining.submitting && state.mining.round !== round) stopMining('本轮挑战已被其他账户完成，已停止计算。请重新开始。');
      renderData();
      renderAccount();
      try {
        const events = await recentTransfers(block.number);
        if (epoch !== state.epoch) { state.refreshAgain = true; return; }
        state.events = events;
        renderEvents();
      } catch {
        $('ledger-count').textContent = '流水同步暂不可用';
        if (!state.events.length) {
          $('recent-events').replaceChildren(empty('流水暂时无法读取。账户余额已同步，请稍后刷新。'));
          $('ledger-events').replaceChildren(emptyTable('流水暂时无法读取，请稍后刷新。'));
        }
      }
    } catch (error) {
      if (epoch !== state.epoch) { state.refreshAgain = true; return; }
      online(false);
      stopMining('测试链连接中断，已停止计算。请重新连接后再试。');
      $('connection-error-text').textContent = friendlyError(error);
      $('connection-error').hidden = false;
      $('last-update').textContent = '同步失败 · 显示上次已知状态';
      renderAccount();
    } finally {
      state.refreshBusy = false;
      $('refresh-button').classList.remove('loading');
      if (state.refreshAgain) { state.refreshAgain = false; setTimeout(refresh, 0); }
    }
  }
  function empty(text) {
    const div = document.createElement('div'); div.className = 'empty-state'; div.textContent = text; return div;
  }
  function emptyTable(text) {
    const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = 6; cell.className = 'empty-state'; cell.textContent = text; row.append(cell); return row;
  }
  function copyButton(value, label = short(value)) {
    const button = document.createElement('button'); button.className = 'hash-copy'; button.textContent = label; button.title = `${value}（点击复制）`; button.addEventListener('click', () => copy(value)); return button;
  }
  function renderEvents() {
    const recent = $('recent-events');
    recent.replaceChildren();
    state.events.slice(0, 3).forEach((event) => {
      const [from, to, amount] = event.args;
      const minted = sameAddress(from, ZERO);
      const row = document.createElement('div'); row.className = 'event-row';
      const icon = document.createElement('span'); icon.className = 'event-icon'; icon.textContent = minted ? '✳' : '↗';
      const info = document.createElement('div'); info.className = 'event-info';
      const title = document.createElement('strong'); title.textContent = minted ? '挖矿奖励 · 新币发行' : 'Soul Quant Coin 转账';
      const addresses = document.createElement('span'); addresses.textContent = minted ? `接收 ${short(to, 9, 6)}` : `${short(from, 8, 5)} → ${short(to, 8, 5)}`;
      info.append(title, addresses);
      const amountEl = document.createElement('div'); amountEl.className = 'event-amount'; amountEl.textContent = `${fmt(amount)} SQC`;
      const block = document.createElement('small'); block.textContent = `区块 ${number(event.blockNumber)}`; amountEl.append(block);
      row.append(icon, info, amountEl); recent.append(row);
    });
    if (!state.events.length) recent.append(empty(isPending() ? 'Sepolia 合约部署准备中，尚无 SQC 链上活动。' : '当前查询区间没有链上活动。完成第一次挖矿，让 Soul Quant Coin 从零开始。'));
    const filtered = $('my-events').checked ? state.events.filter((event) => sameAddress(event.args[0], state.address) || sameAddress(event.args[1], state.address)) : state.events;
    $('ledger-count').textContent = `${number(filtered.length)} 条记录`;
    const tbody = $('ledger-events'); tbody.replaceChildren();
    filtered.forEach((event) => {
      const [from, to, amount] = event.args;
      const minted = sameAddress(from, ZERO);
      const row = document.createElement('tr');
      const type = document.createElement('td'); const badge = document.createElement('span'); badge.className = `type-tag${minted ? '' : ' transfer'}`; badge.textContent = minted ? '挖矿铸币' : '转账'; type.append(badge);
      const sender = document.createElement('td'); if (minted) { sender.textContent = '新币发行'; sender.title = ZERO; } else sender.append(copyButton(from));
      const receiver = document.createElement('td'); receiver.append(copyButton(to));
      const value = document.createElement('td'); value.className = 'amount-cell'; value.textContent = fmt(amount);
      const block = document.createElement('td'); block.textContent = number(event.blockNumber);
      const hash = document.createElement('td'); hash.append(copyButton(event.transactionHash, short(event.transactionHash, 8, 5)));
      row.append(type, sender, receiver, value, block, hash); tbody.append(row);
    });
    if (!filtered.length) tbody.append(emptyTable(isPending() ? '合约尚未部署，暂无链上记录。' : $('my-events').checked ? '当前查询区间内，该账户没有铸币或转账记录。' : '当前查询区间内没有链上记录。'));
  }
  function receiptFeedback(element, description, transactionHash) {
    message(element, description);
    if (transactionHash) {
      element.append(document.createElement('br'));
      element.append(copyButton(transactionHash, `交易 ${short(transactionHash, 14, 10)} · 点击复制`));
    }
  }
  async function transfer(event) {
    event.preventDefault();
    if (isPending() || !state.token || state.busyTransfer || state.mining || !state.signer || !state.online) return;
    const recipient = $('recipient').value.trim();
    const amountText = $('amount').value.trim();
    const feedback = $('transfer-feedback');
    if (!ethers.isAddress(recipient)) { message(feedback, '请输入有效的 Ethereum 收款地址（0x 开头，共 42 个字符）。', 'error'); $('recipient').focus(); return; }
    if (sameAddress(recipient, ZERO)) { message(feedback, '不能向零地址转账，请填写实际收款地址。', 'error'); return; }
    if (!/^\d+(?:\.\d{1,8})?$/.test(amountText)) { message(feedback, '请输入正数数量，最多支持 8 位小数，不使用逗号或科学计数法。', 'error'); $('amount').focus(); return; }
    let amount;
    try { amount = ethers.parseUnits(amountText, 8); }
    catch { message(feedback, '数量超出支持范围，请填写有效的 SQC 数量。', 'error'); return; }
    if (amount <= 0n) { message(feedback, '发送数量必须大于 0。', 'error'); return; }
    const snap = snapshot();
    state.busyTransfer = true; updateActions();
    message(feedback, '正在检查余额与当前账户…', 'pending');
    let sentHash = null;
    try {
      const balance = await state.token.balanceOf(snap.address);
      if (amount > balance) { message(feedback, `余额不足：当前可发送 ${fmt(balance)} SQC。`, 'error'); return; }
      const request = await prepareTransaction(snap, 'transfer', [recipient, amount]);
      await assertSigner(snap);
      if (!current(snap)) throw staleError();
      message(feedback, snap.mode === 'wallet' ? `请在钱包中确认这笔${networkName()}转账…` : '正在提交本地测试链转账…', 'pending');
      sentHash = await broadcast(snap, request);
      if (current(snap)) message(feedback, '交易已提交，等待链上确认…', 'pending');
      const receipt = await state.provider.waitForTransaction(sentHash);
      if (receipt.status !== 1) throw new Error('交易未成功执行。');
      if (current(snap)) {
        receiptFeedback(feedback, `已发送 ${fmt(amount)} SQC 至 ${short(recipient, 9, 7)}。`, sentHash);
        $('amount').value = '';
        toast('转账成功，余额与流水已更新');
      } else toast(`原账户转账已确认：${short(sentHash, 10, 6)}`);
      await refresh();
    } catch (error) {
      if (current(snap)) {
        message(feedback, friendlyError(error), 'error');
        if (sentHash) { feedback.append(document.createElement('br')); feedback.append(copyButton(sentHash, '已提交交易 · 点击复制哈希核对')); }
      } else toast(sentHash ? '原账户交易已提交，可在链上流水中核对结果。' : '账户或网络已改变，请重新填写并发送。');
    } finally { state.busyTransfer = false; updateActions(); }
  }
  function renderCompute(job) {
    const elapsed = (performance.now() - job.startedAt) / 1000;
    $('hash-count').textContent = number(job.attempts);
    $('hash-rate').textContent = `${number(elapsed ? Math.round(job.attempts / elapsed) : 0)} H/s`;
    $('hash-elapsed').textContent = `${elapsed.toFixed(1)} 秒`;
    $('hash-nonce').textContent = job.lastNonce === null ? '—' : job.lastNonce.toString();
    $('hash-digest').textContent = job.digest || '等待计算…';
  }
  function setMiningUi(job, status, live) {
    $('mining-status').textContent = status;
    $('compute-live').textContent = live;
    $('compute-live').classList.toggle('active', Boolean(job));
    $('page-mining').classList.toggle('is-mining', Boolean(job));
    $('start-mining').querySelector('span').textContent = job ? job.submitting ? '等待确认…' : '正在计算…' : '开始挖矿';
    updateActions();
  }
  function stopMining(reason = '已停止挖矿，可以随时重新开始。') {
    const job = state.mining;
    if (!job || job.submitting) return;
    job.cancelled = true;
    state.mining = null;
    setMiningUi(null, '已停止', '计算已停止');
    message($('mining-feedback'), reason);
  }
  function jobCurrent(job) { return state.mining === job && !job.cancelled && current(job.snap); }
  async function startMining() {
    if (isPending() || !state.token || !state.signer || !state.online || state.mining || state.busyTransfer || !state.data) return;
    const job = {
      snap: snapshot(), startedAt: performance.now(), attempts: 0, lastNonce: null,
      digest: null, cancelled: false, submitting: false, round: state.data.round,
    };
    state.mining = job;
    renderCompute(job); setMiningUi(job, '计算中', 'CPU 正在计算');
    message($('mining-feedback'), '正在读取本轮挑战…', 'pending');
    let sentHash = null;
    try {
      const [round, challenge, target, reward] = await Promise.all([state.token.miningRound(), state.token.challenge(), state.token.miningTarget(), state.token.currentReward()]);
      if (!jobCurrent(job)) return;
      if (reward === 0n) throw new Error('所有可挖奖励已发行完毕。');
      job.round = round;
      job.startedAt = performance.now();
      message($('mining-feedback'), `正在寻找第 ${number(round)} 轮的有效哈希…`, 'pending');
      let nonce = BigInt(ethers.hexlify(ethers.randomBytes(8)));
      let found = false;
      let lastRender = 0;
      while (!found && jobCurrent(job)) {
        const deadline = performance.now() + 24;
        do {
          job.lastNonce = nonce;
          job.digest = ethers.solidityPackedKeccak256(
            ['uint256', 'address', 'uint256', 'bytes32', 'address', 'uint256'],
            [state.config.chainId, state.config.address, round, challenge, job.snap.address, nonce],
          );
          job.attempts += 1;
          if (BigInt(job.digest) <= target) { found = true; break; }
          nonce += 1n;
        } while (performance.now() < deadline);
        if (performance.now() - lastRender > 90 || found) { renderCompute(job); lastRender = performance.now(); }
        await sleep(0);
      }
      if (!jobCurrent(job)) return;
      setMiningUi(job, '找到有效哈希', '计算已完成');
      while (jobCurrent(job)) {
        const [currentRound, currentChallenge, nextAt, block] = await Promise.all([state.token.miningRound(), state.token.challenge(), state.token.nextMiningAt(), state.provider.getBlock('latest')]);
        if (!jobCurrent(job)) return;
        if (currentRound !== round || currentChallenge !== challenge) throw new Error('Round changed');
        if (!block) throw new Error('无法读取最新区块。');
        // 本地 automine 仅在交易时出块，空闲链的最新块时间不会自动推进。
        const wait = Number(nextAt) - (isPublic() ? block.timestamp : Math.max(block.timestamp, Math.floor(Date.now() / 1000)));
        if (wait <= 0) break;
        setMiningUi(job, '等待申领时间', '有效哈希已找到');
        message($('mining-feedback'), `有效哈希已找到。等待全网申领间隔结束（约 ${wait} 秒），期间可停止。`, 'pending');
        await sleep(isPublic() ? 3000 : 500);
      }
      if (!jobCurrent(job)) return;
      const request = await prepareTransaction(job.snap, 'mine', [round, nonce]);
      if (!jobCurrent(job)) return;
      await assertSigner(job.snap);
      if (!jobCurrent(job)) return;
      job.submitting = true;
      setMiningUi(job, '提交奖励申领', '等待交易确认');
      message($('mining-feedback'), job.snap.mode === 'wallet' ? '请在钱包中确认挖矿申领交易…' : '正在提交有效哈希并申领奖励…', 'pending');
      sentHash = await broadcast(job.snap, request);
      if (current(job.snap)) message($('mining-feedback'), '挖矿交易已提交，等待链上确认…', 'pending');
      const receipt = await state.provider.waitForTransaction(sentHash);
      if (receipt.status !== 1) throw new Error('挖矿申领未成功执行。');
      if (current(job.snap)) {
        receiptFeedback($('mining-feedback'), `挖矿成功！${fmt(reward)} SQC 已发放到当前账户。`, sentHash);
        setMiningUi(null, '挖矿成功', '本轮计算完成');
        toast(`挖矿成功，获得 ${fmt(reward)} SQC`);
      } else toast(`原账户挖矿申领已确认：${short(sentHash, 10, 6)}`);
      await refresh();
    } catch (error) {
      if (job.cancelled) return;
      if (current(job.snap)) {
        message($('mining-feedback'), friendlyError(error), 'error');
        if (sentHash) { $('mining-feedback').append(document.createElement('br')); $('mining-feedback').append(copyButton(sentHash, '已提交交易 · 点击复制哈希核对')); }
        setMiningUi(null, '本轮未完成', '等待重新开始');
      } else toast(sentHash ? '原账户申领已提交，可在链上流水中核对结果。' : '账户或网络已改变，挖矿申领已取消。');
    } finally {
      if (state.mining === job) {
        state.mining = null;
        $('page-mining').classList.remove('is-mining');
        $('compute-live').classList.remove('active');
        $('start-mining').querySelector('span').textContent = '开始挖矿';
        if (!current(job.snap)) setMiningUi(null, '账户已改变', '等待重新开始');
        updateActions();
      }
    }
  }
  function navigate() {
    const requested = location.hash.slice(1);
    const page = pageNames[requested] ? requested : 'wallet';
    document.querySelectorAll('.page').forEach((section) => { section.hidden = section.id !== `page-${page}`; });
    document.querySelectorAll('[data-page]').forEach((link) => { link.classList.toggle('active', link.dataset.page === page); if (link.dataset.page === page) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
    $('page-breadcrumb').textContent = pageNames[page];
    document.title = `${pageNames[page]} · Soul Quant Coin 实验室`;
  }
  function configurePublicUi() {
    if (!isPublic()) return;
    document.body.classList.add('public-testnet');
    state.mode = 'wallet';
    state.accounts = [];
    $('network-badge').hidden = false;
    $('connection-text').textContent = '正在连接 Sepolia';
    $('sidebar-network').textContent = 'Sepolia 公共测试网';
    $('wallet-mode-badge').textContent = 'Sepolia 测试网 · 无市场价值';
    $('wallet-intro').textContent = '连接你自己的钱包，在公共测试网上体验挖矿与转账。';
    $('wallet-notice').textContent = '这是 Sepolia 公共测试网代币。使用个人钱包签名，手续费需 Sepolia ETH；测试代币没有市场价值。';
    $('use-dev').hidden = true;
    $('account-source').classList.add('wallet-only');
    $('switch-chain').textContent = '添加 / 切换 Sepolia ↗';
    $('mining-network-badge').textContent = 'CPU 演示 · Sepolia';
    $('transfer-hint').textContent = '支持最多 8 位小数，手续费使用 Sepolia ETH。';
    $('mining-help').textContent = '浏览器计算有效哈希后，在个人钱包中签名申领奖励。需少量 Sepolia ETH 支付手续费。';
    $('config-chain').textContent = `Ethereum Sepolia · ${state.config.chainId}`;
    $('profile-name').textContent = '公共测试网';
    $('config-interval').textContent = `${number(state.config.miningInterval)} 秒`;
    $('config-difficulty').textContent = `${number(state.config.difficultyBits)} bits`;
    $('environment-heading').textContent = '公共测试网的实验环境';
    $('environment-info').textContent = '账户由各自钱包管理，账本由 Sepolia 网络维护。SQC 与 Sepolia ETH 均用于测试，没有市场价值。';
    $('profile-note').textContent = `当前公共测试规则为 ${number(state.config.miningInterval)} 秒最短申领间隔 / ${number(state.config.difficultyBits)} bits 难度。这是测试网实验，尚未部署到主网，也不代表已完成外部安全审计。`;
    $('footer-network').textContent = 'Sepolia · 学习与实验';
    $('ledger-footnote').textContent = '从合约部署区块起，查询最近最多 5,000 个区块内的 80 条 Transfer 记录。可复制地址与交易哈希。';
    if (isPending()) {
      $('deployment-notice').hidden = false;
      $('contract-address').textContent = '尚未部署';
      $('supply-percent').textContent = '合约部署准备中';
      $('mechanism-description').textContent = 'SQC 计划部署在 Ethereum Sepolia 测试网，采用 ERC-20 账户体系。公开发行规则为无 owner 权限、无额外增发入口与交易税，所有发行来自满足规则的挖矿申领。当前合约尚未部署。';
      $('mining-status').textContent = '等待合约部署';
    }
    if (state.config.faucetUrl) {
      try {
        const faucet = new URL(state.config.faucetUrl);
        if (faucet.protocol === 'https:') {
          $('faucet-section').hidden = false;
          $('faucet-link').href = faucet.href;
        }
      } catch { /* 无效的外链不显示。 */ }
    }
    if (isPending() && ethers.isAddress(state.config.deployerAddress || '')) {
      $('deployment-notice').append(document.createElement('br'));
      const hint = document.createElement('span');
      hint.textContent = '部署测试账户：';
      $('deployment-notice').append(hint, copyButton(state.config.deployerAddress, state.config.deployerAddress));
    }
  }
  async function initialize() {
    navigate();
    updateActions();
    try {
      if (!window.ethers) throw new Error('钱包组件尚未加载，请刷新页面后重试。');
      let response = await fetch(new URL('api/config.json', document.baseURI), { cache: 'no-store' });
      if (response.status === 404 && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
        response = await fetch('/api/config', { cache: 'no-store' });
      }
      if (!response.ok) throw new Error('实验室配置无法读取，请确认启动与部署已完成。');
      const config = await response.json();
      const validAddress = config.address && ethers.isAddress(config.address) && !sameAddress(config.address, ZERO);
      if (!Array.isArray(config.abi) || !config.chainId || !config.rpcUrl || (!validAddress && !config.publicTestnet)) throw new Error('实验室配置尚未就绪，请等待启动程序完成后重新连接。');
      config.rpcUrl = new URL(config.rpcUrl, document.baseURI).href;
      if (config.publicTestnet) {
        const rpc = new URL(config.rpcUrl);
        if (rpc.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(rpc.hostname)) throw new Error('公共测试网页必须使用 HTTPS 公共 RPC。');
        if (Number(config.chainId) !== 11155111) throw new Error('公共测试网页当前仅支持 Sepolia。');
        config.deploymentPending = config.deploymentPending === true || !validAddress;
        if (!validAddress) config.address = null;
      }
      state.config = config;
      state.provider = new ethers.JsonRpcProvider(config.rpcUrl, undefined, config.publicTestnet ? { batchMaxCount: 1 } : undefined);
      state.token = config.address && !config.deploymentPending ? new ethers.Contract(config.address, config.abi, state.provider) : null;
      $('config-chain').textContent = `Ethereum 本地链 · ${config.chainId}`;
      $('config-rpc').textContent = config.rpcUrl;
      $('contract-address').textContent = config.address || '尚未部署';
      $('copy-contract').disabled = !state.token;
      $('profile-name').textContent = config.profile === 'local-fast' ? '本地快速测试' : '正式节奏测试';
      configurePublicUi();
      if (window.ethereum?.on) {
        const changed = () => {
          if (state.mode !== 'wallet') return;
          invalidateAccount();
          state.resolvingWallet = false;
          connectWallet(false);
        };
        window.ethereum.on('accountsChanged', changed);
        window.ethereum.on('chainChanged', changed);
        window.ethereum.on('disconnect', () => {
          if (state.mode !== 'wallet') return;
          invalidateAccount(); state.resolvingWallet = false;
          message($('wallet-message'), isPublic() ? '钱包已断开连接，请重新连接个人钱包。' : '钱包已断开连接，请重新连接或使用本地开发账户。', 'error');
          renderAccount();
        });
      }
      if (isPublic()) {
        renderAccount();
        if (window.ethereum) await connectWallet(false);
        else {
          message($('wallet-message'), '手机请使用 MetaMask App 内置浏览器打开此页面，即可连接个人钱包。电脑可使用已有的钱包扩展。');
          await refresh();
        }
      } else await useDev();
    } catch (error) {
      online(false);
      $('connection-error-text').textContent = friendlyError(error);
      $('connection-error').hidden = false;
      $('last-update').textContent = isPublic() ? '等待 Sepolia 状态同步' : '等待实验室连接';
    }
  }
  window.addEventListener('hashchange', navigate);
  $('refresh-button').addEventListener('click', () => state.config ? refresh() : initialize());
  $('retry-button').addEventListener('click', () => state.config ? (state.mode === 'dev' && !state.signer ? useDev() : refresh()) : initialize());
  $('use-dev').addEventListener('click', () => useDev());
  $('connect-wallet').addEventListener('click', () => connectWallet());
  $('account-select').addEventListener('change', (event) => useDev(event.target.value));
  $('copy-address').addEventListener('click', () => copy(state.address));
  $('copy-contract').addEventListener('click', () => copy(state.config?.address));
  $('switch-chain').addEventListener('click', switchChain);
  $('watch-token').addEventListener('click', watchToken);
  $('transfer-form').addEventListener('submit', transfer);
  $('max-amount').addEventListener('click', () => { if (isPending() || !state.token) return; $('amount').value = ethers.formatUnits(state.balance, 8).replace(/\.0$/, ''); });
  $('start-mining').addEventListener('click', startMining);
  $('stop-mining').addEventListener('click', () => stopMining());
  $('my-events').addEventListener('change', renderEvents);
  setInterval(() => { updateCountdown(); }, 1000);
  setInterval(() => { if (state.provider && !document.hidden) refresh(); }, 10000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.provider) refresh(); });
  initialize();
})();

import {reactive,watch} from 'vue';
import ArcControlService from './ArcControlService.ts';
import AppProperties from './AppProperties.ts';

const GitService = {

  _: reactive({
    remotes: {},
    branches: [],

    lfs_files: new Map(),
    lfs_size_limit: 1,

    rebase_in_progress: false,

    change_tree: [],
    change_tree_expanded: [],
    change_tree_selected: [],
    change_tree_selected_: '',
  }),

  get_leaf_nodes: (nodes,node) => {
    node = node || GitService._.change_tree[0];
    if(node.children.length<1)
      return nodes.push(node);
    node.children.map(c=>GitService.get_leaf_nodes(nodes,c));
  },

  build_change_tree: status => {
    const root = [{
      id: '.',
      name: 'Changes',
      children: [],
      header: 'root'
    }];

    const unselect = nodes => {
      for(let n of nodes){
        const idx = GitService._.change_tree_selected.indexOf(n.id);
        idx>=0 && GitService._.change_tree_selected.splice(idx,1);
      }
    };
    const select = nodes => {
      for(let n of nodes){
        const idx = GitService._.change_tree_selected.indexOf(n.id);
        idx<0 && GitService._.change_tree_selected.push(n.id);
      }
      GitService._.change_tree_selected = GitService._.change_tree_selected.filter(id=>!id.endsWith('.xlsx'));
    };

    const handler = node => {
      const leaf_nodes = [];
      GitService.get_leaf_nodes(leaf_nodes,node);

      const n_selected = leaf_nodes.filter(n=>GitService._.change_tree_selected.includes(n.id)).length;
      if(n_selected===leaf_nodes.length)
        unselect(leaf_nodes)
      else
        select(leaf_nodes)
    };

    status.forEach(([type,path,size]) => {
      const segments = path.split('/');
      let current = root[0].children;
      for(let s=0; s<segments.length; s++){
        const segment = segments[s];
        const subpath = segments.slice(0,s+1).join('/');
        let node = current.filter(n=>n.id===subpath)[0];
        if(!node){
          node = {
            id: subpath,
            name: segment,
            children: [],
            handler: handler,
            size: 0
          };
          current.push(node);
        }
        current = node.children;
        node.size += size;
        if(s===segments.length-1){
          node.type = type;
          node.icon = type.includes(' D') ? 'indeterminate_check_box' : type.includes(' M') ? 'edit_square' : 'add_box';
        }
      }
    });

    const add_parent_pointers = node => {
      node.children.map(c=>{c.parent=node;add_parent_pointers(c)});
    };
    add_parent_pointers(root[0]);

    GitService._.change_tree = root;
    return root;
  },

  select_lfs_nodes: async ()=>{

    await GitService.update_lfs_files();
    GitService._.change_tree_selected = [];
    const init_select_nodes = node => {
      if(node.children.length<1 && !node.id.endsWith('.xlsx') && (node.id.toLowerCase().includes('/dataset/') || node.size>=parseFloat(GitService._.lfs_size_limit)*1024*1024 || GitService._.lfs_files.has(node.id)))
        GitService._.change_tree_selected.push(node.id)
      node.children.map(init_select_nodes);
    };
    GitService._.change_tree[0].children.map(init_select_nodes);
  },

  parse_status: async ()=>{
    const status_raw = await window.ipc.invoke('GitService.run', {
      args: [`status`],
      cwd: ArcControlService.props.arc_root
    });
    GitService._.rebase_in_progress = status_raw[1].startsWith('interactive rebase in progress');

    const response = await window.ipc.invoke('GitService.run', {
      args: [`status`,`-z`,`-u`],
      cwd: ArcControlService.props.arc_root
    });
    const status = response[1].split('\u0000').map(x => [x.slice(0,2),x.slice(3)]).slice(0,-1);
    const sizes = await window.ipc.invoke('LocalFileSystemService.getFileSizes', status.map(x=> ArcControlService.props.arc_root +'/'+x[1]));
    for(let i in sizes)
      status[i].push(sizes[i]);

    GitService.build_change_tree(status);
    GitService.select_lfs_nodes();
    GitService._.change_tree_expanded = ['.'];
    {
      const expand_children = node => {
        if(node.children.length>5) return;
        GitService._.change_tree_expanded.push(node.id);
        for(let child of node.children)
          expand_children(child);
      }
      for(let child of GitService._.change_tree[0].children)
        expand_children(child);
    }
  },

  update_lfs_files: async () => {
    const lfs_files = await window.ipc.invoke('GitService.run', {
      args: ['lfs','ls-files'],
      cwd: ArcControlService.props.arc_root
    });
    if(!lfs_files[0])
      return console.error('unable to fetch LFS file list');

    GitService._.lfs_files = new Map();

    lfs_files[1].split('\n').map(
      r=>{
        const e = r.split(' ');
        GitService._.lfs_files.set(e.slice(2).join(' '), e[1]==='*');
      }
    );
  },

  get_url_credentials: url => {
    // Regular expression to match URLs with embedded credentials
    const regex = /^(https?|git|ssh):\/\/([^\/:@]+(:[^\/:@]+)?@)?([^\/:]+)(:[0-9]+)?(\/.*)?$/;
    // Test the URL against the regular expression
    const match = url.match(regex);
    return match ? (match[2] || '') : '';
  },

  patch_remote: url => {
    return AppProperties.user && url.includes(AppProperties.user.host) && GitService.get_url_credentials(url)===''
      ? `https://oauth2:${AppProperties.user.token.access_token}@${AppProperties.user.host}` + url.split(AppProperties.user.host)[1]
      : url;
  },

  set_git_user: async(name,email)=>{
    let response = null;
    // set git user and email
    response = await window.ipc.invoke('GitService.run', {
      args: [`config`,`--replace-all`,`user.name`,'"'+name+'"'],
      cwd: ArcControlService.props.arc_root
    });
    if(!response[0]) return response;
    response = await window.ipc.invoke('GitService.run', {
      args: [`config`,`--replace-all`,`user.email`,email],
      cwd: ArcControlService.props.arc_root
    });
    return response;
  },

  get_branches: async () => {
    const response = await window.ipc.invoke('GitService.run', {
      args: [`branch`],
      cwd: ArcControlService.props.arc_root
    });
    const branches_raw = response[1].split('\n').slice(0,-1);
    const branches = {
      list: [],
      current: null
    };
    for(let branch of branches_raw){
      const branch_name = branch.slice(2);
      branches.list.push(branch_name);
      if(branch[0]==='*')
        branches.current = branch_name;
    }

    GitService._.branches = branches;
    return branches;
  },

  check_remotes: async()=>{
    const branches = await GitService.get_branches();

    const hash_response = await window.ipc.invoke('GitService.run', {
      args: [`rev-parse`,`HEAD`],
      cwd: ArcControlService.props.arc_root
    });
    const latest_local_hash = hash_response[1].trim();

    for(let id in GitService._.remotes){
      const url = GitService.patch_remote(GitService._.remotes[id].url);
      if(AppProperties.user && url.includes(AppProperties.user.host)){
        const fetch_response = await window.ipc.invoke('GitService.run', {
          args: [`ls-remote`,url,`-h`,`refs/heads/${branches.current}`],
          cwd: ArcControlService.props.arc_root
        });
        GitService._.remotes[id].dirty = fetch_response[0] && latest_local_hash!==fetch_response[1].split('\t')[0];
      }
    }
  },

  get_remotes: async()=>{
    const response = await window.ipc.invoke('GitService.run', {
      args: [`remote`,`-v`],
      cwd: ArcControlService.props.arc_root
    });
    GitService._.remotes = {};

    for(let row of response[1].split('\n').slice(0,-1)){
      const row_ = row.split('\t');
      const name = row_[0];
      const url = row_[1].split(' ')[0];

      GitService._.remotes[name] = {
        url: url,
        dirty: false
      };
    }

    return GitService._.remotes;
  },

  init: ()=>{
    watch(()=>GitService._.lfs_size_limit, GitService.select_lfs_nodes);
  }
};

GitService.init();

export default GitService;

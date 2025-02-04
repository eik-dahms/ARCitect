
import { reactive } from 'vue'

import AppProperties from './AppProperties.ts';
import SwateControlService from './SwateControlService.ts';

import { ARC, ArcInvestigation } from "@nfdi4plants/arctrl";
import { gitignoreContract } from "@nfdi4plants/arctrl/Contract/Git";
import { Xlsx } from '@fslab/fsspreadsheet/Xlsx.js';
import {Contract} from '@nfdi4plants/arctrl/Contract/Contract.js'

import pDebounce from 'p-debounce';

export const Investigation = "investigation";
export const Studies = "studies";
export const Assays = "assays";
export const Protocols = 'protocols';
export const Dataset = 'dataset';
export const Runs = 'runs';
export const Workflows = 'workflows';

let init: {
    arc_root: undefined | string ,
    busy: boolean,
    arc: null | ARC,
    git_initialized: boolean,
    skip_fs_updates: boolean,
} = {
    arc_root: undefined ,
    busy: false,
    arc: null,
    git_initialized: false,
    skip_fs_updates: false
}

function relative_to_absolute_path(relativePath: string) {
  return ArcControlService.props.arc_root + '/' + relativePath
}

const ArcControlService = {

  props: reactive(init),

  closeARC: async() => {
    ArcControlService.props.arc_root = undefined;
    ArcControlService.props.busy = false;
    ArcControlService.props.arc = null;
    AppProperties.state = 0;
    return;
  },

  readARC: async (arc_root: string | void | null) =>{
    arc_root = arc_root || ArcControlService.props.arc_root;
    if(!arc_root)
      return false;

    const isARC = await window.ipc.invoke('LocalFileSystemService.exists', arc_root+'/isa.investigation.xlsx');

    if (!isARC) {
      ArcControlService.closeARC();
      return false;
    }

    ArcControlService.props.busy = true;

    const xlsx_files = await window.ipc.invoke('LocalFileSystemService.getAllXLSX', arc_root);
    const arc = ARC.fromFilePaths(xlsx_files);
    const contracts = arc.GetReadContracts();
    for(const contract of contracts){
      const buffer = await window.ipc.invoke('LocalFileSystemService.readFile', [arc_root+'/'+contract.Path,{}]);
      contract.DTO = await Xlsx.fromBytes(buffer);
    }
    arc.SetISAFromContracts(contracts);
    ArcControlService.props.arc = arc;
    ArcControlService.props.arc_root = arc_root;

    const git_initialized = await window.ipc.invoke('GitService.run',{
      args: [`status`],
      cwd: arc_root
    });
    ArcControlService.props.git_initialized = git_initialized[0];

    ArcControlService.props.busy = false;
    console.log(arc);
    return true;
  },

  handleARCContracts: async (contracts: Contract [], arc: ARC, arc_root: string) => {
    arc = arc || ArcControlService.props.arc;
    arc_root = arc_root || ArcControlService.props.arc_root;
    if(!arc || !arc_root)
      return;
    ArcControlService.props.busy = true;
    arc.UpdateFileSystem();
    for(const contract of contracts) {
      console.log('CONTRACT',contract);
      switch (contract.Operation) {
        case 'DELETE':
          await window.ipc.invoke(
            'LocalFileSystemService.remove',
            arc_root + '/' +contract.Path
          );
          break;
        case 'UPDATE': case 'CREATE':
          if(['ISA_Investigation','ISA_Study','ISA_Assay', 'ISA_Datamap'].includes(contract.DTOType)){
            const buffer = await Xlsx.toBytes(contract.DTO);
            const absolutePath = arc_root + '/' +contract.Path;
            await window.ipc.invoke(
              'LocalFileSystemService.writeFile',
              [
                absolutePath,
                buffer,
                {}
              ]
            );
            break;
          } else if(contract.DTOType==='PlainText'){
            await window.ipc.invoke('LocalFileSystemService.writeFile', [
              arc_root+'/'+contract.Path,
              contract.DTO || '',
              {encoding:'UTF-8', flag: 'wx'}
            ]);
          } else {
            return console.log('unable to resolve write contract', contract);
          }
          break;
        case 'RENAME':
          await window.ipc.invoke(
            'LocalFileSystemService.rename',
            [
              arc_root + '/' + contract.Path,
              arc_root + '/' + contract.DTO
            ]
          );
          break;
        default:
          console.log(`Warning. 'handleARCContracts' hit unknown expression for contract type: ${contract.Operation} in ${contract}.`)
          break;
      }
    }
  },

  saveARC: async (options:{
      arc_root?: string,
      arc?: ARC,
      force?:boolean
  })=>{
    options = options || {};
    const arc = options.arc || ArcControlService.props.arc;
    if(!arc)
      return;
    const arc_root = options.arc_root || ArcControlService.props.arc_root;
    if(!arc_root)
      return;

    ArcControlService.props.busy = true;

    arc.UpdateFileSystem();
    let contracts = options.force ? arc.GetWriteContracts() : arc.GetUpdateContracts();

    /// Add default .gitignore if it does not exist
    const ignore_exists = await window.ipc.invoke(
      'LocalFileSystemService.exists',
      arc_root + '/.gitignore'
    );
    if(!ignore_exists)
      contracts.push(
        );

    await ArcControlService.handleARCContracts(contracts, arc, arc_root);

    ArcControlService.props.busy = false;
  },

  delete: async (method:string, identifier:string) => {
    await ArcControlService.handleARCContracts(
      ArcControlService.props.arc[method](identifier)
    );
  },

  rename: async (method:string, old_identifier:string, new_identifier:string) => {
    await ArcControlService.handleARCContracts(
      ArcControlService.props.arc[method](
        old_identifier,
        new_identifier
      )
    );
  },

  newARC: async (path: string) =>{
    const arc = new ARC(
      ArcInvestigation.init(path.split('/').pop())
    );
    await ArcControlService.saveARC({
      arc_root:path,
      arc:arc,
      force: true
    });
    await ArcControlService.readARC(path);
    await window.ipc.invoke('GitService.run', {
      args: ['init','-b','main'],
      cwd: path
    });
    await window.ipc.invoke('GitService.run', {
      args: ['add','isa.investigation.xlsx','assays/','studies/','runs/','workflows/'],
      cwd: path
    });
    await window.ipc.invoke('GitService.run', {
      args: ['commit','-m','init','--author','"ARCitect <info@nfdi4plants.org>"'],
      cwd: path
    });
  },

  openArcInExplorer: async (arc_root: string | null | void) => {
    if(!arc_root)
      arc_root = ArcControlService.props.arc_root;
    if(!arc_root)
      return;
    await window.ipc.invoke('LocalFileSystemService.openPath', arc_root);
  },

  updateARCfromFS: async ([path,type]) => {
    if(ArcControlService.props.skip_fs_updates) return;
    // track add/rm assays/studies through file explorer
    const requires_update = path.includes('isa.assay.xlsx') || path.includes('isa.study.xlsx');
    if(!requires_update) return;
    debouncedReadARC();
  },

  updateGitIgnore: async (path:string) => {
    const entry = path.replace(ArcControlService.props.arc_root,'');
    const ignore_exists = await window.ipc.invoke('LocalFileSystemService.exists', ArcControlService.props.arc_root+'/.gitignore');
    if(!ignore_exists)
      await ArcControlService.saveARC({});

    const ignore_string = await window.ipc.invoke('LocalFileSystemService.readFile', ArcControlService.props.arc_root+'/.gitignore');
    const line_delimiter = ignore_string.indexOf('\r\n')<0 ? '\n' : '\r\n';
    const ignore_entries = ignore_string.split(line_delimiter);

    const entry_index = ignore_entries.indexOf(entry);
    if(entry_index<0){
      ignore_entries.push(entry);
      await window.ipc.invoke('GitService.run', {
        args: ['reset', '.'+entry],
        cwd: ArcControlService.props.arc_root
      });
      await window.ipc.invoke('GitService.run', {
        args: ['rm', '--cached', '.'+entry],
        cwd: ArcControlService.props.arc_root
      });
    } else {
      ignore_entries.splice(entry_index,1);
      await window.ipc.invoke('GitService.run', {
        args: [`add`,'.'+entry],
        cwd: ArcControlService.props.arc_root
      });
    }
    await window.ipc.invoke('LocalFileSystemService.writeFile', [ArcControlService.props.arc_root+'/.gitignore', ignore_entries.join(line_delimiter)]);
    AppProperties.force_commit_update++;
  }
};

const debouncedReadARC = pDebounce(ArcControlService.readARC, 300);

window.ipc.on('LocalFileSystemService.updatePath', ArcControlService.updateARCfromFS);
window.ipc.on('CORE.getArcRoot', callback=>window.ipc.invoke(callback, ArcControlService.props.arc_root));

export default ArcControlService;

<template>
  <div class="q-py-sm">

    <h5 style="margin-bottom:0.5em;">
      <q-icon color="grey-8" name="rule" /> Commit Changes
    </h5>

    <q-card>

      <q-item>
        <div>
          This menu allows you to "commit" your changes locally. This saves the changes of your local ARC
          together with your <a href="https://git.nfdi4plants.org/" target="_blank">DataHUB</a> credentials (Name and
          eMail).
        </div>
      </q-item>

      <q-item>
        <div class="text-body2 text-justify" style="padding-bottom:1em;">
          Versioning helps you keep track of your ARC's changes. If you are new to the ARC, the <strong>Commit</strong>
          and <strong>DataHUB Sync</strong>
          menus are likely a more complex feature of the ARC and ARCitect. Feel free to <a
            href="https://helpdesk.nfdi4plants.org" target="_blank">contact DataPLANT</a> for data steward support.
        </div>
      </q-item>
    </q-card>

    <q-separator />

    <q-card>
      <q-item>
        <div>
          Check out the DataPLANT knowledgebase to learn more about <a
            href="https://nfdi4plants.github.io/nfdi4plants.knowledgebase/git/git-lfs/"
            target="_blank">large file storage (LFS)</a> and
          <a href="https://nfdi4plants.github.io/nfdi4plants.knowledgebase/git/git-syncing-recommendation/"
            target="_blank">commit messages</a>.


            <!-- TODO: add explanation about branches  -->

        </div>
      </q-item>
    </q-card>

  </div>
</template>

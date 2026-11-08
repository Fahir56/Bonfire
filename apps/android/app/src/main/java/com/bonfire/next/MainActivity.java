package com.bonfire.next;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public class MainActivity extends Activity {
    private static final int FILE_PICKER = 151, MIC_REQUEST = 152, WRITE_REQUEST = 153;
    private WebView web;
    private ValueCallback<Uri[]> pendingFiles;
    private PermissionRequest pendingMicrophone;
    private String pendingDownload;
    private String baseUrl;
    private String host;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        baseUrl = getString(R.string.bonfire_url).trim();
        Uri root = Uri.parse(baseUrl);
        host = root.getHost();
        if(!"https".equals(root.getScheme()) || host == null || host.contains("YOUR-BONFIRE")) {
            new AlertDialog.Builder(this).setTitle("Configure Bonfire")
                .setMessage("Set bonfire_url in apps/android/app/src/main/res/values/strings.xml to your real HTTPS Bonfire site before building the APK.")
                .setPositiveButton("OK", (d,w) -> finish()).show();
            return;
        }
        web = new WebView(this);
        setContentView(web);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(false);
        if(Build.VERSION.SDK_INT>=26) settings.setSafeBrowsingEnabled(true);
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request){
                Uri uri=request.getUrl();
                if(isSameOrigin(uri))return false;
                try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception ignored){}
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params){
                if(pendingFiles!=null)pendingFiles.onReceiveValue(null);
                pendingFiles=cb;
                try{
                    Intent intent=new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("*/*");
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    startActivityForResult(Intent.createChooser(intent,"Choose file for Bonfire"),FILE_PICKER);
                    return true;
                }catch(ActivityNotFoundException e){pendingFiles=null;cb.onReceiveValue(null);return false;}
            }
            @Override public void onPermissionRequest(PermissionRequest request){
                runOnUiThread(() -> {
                    if(!isSameOrigin(request.getOrigin()) || !contains(request.getResources(),PermissionRequest.RESOURCE_AUDIO_CAPTURE)){
                        request.deny();return;
                    }
                    pendingMicrophone=request;
                    new AlertDialog.Builder(MainActivity.this).setTitle("Bonfire voice chat")
                        .setMessage("Allow Bonfire to use your microphone for voice chat?")
                        .setNegativeButton("No",(d,w)->{request.deny();pendingMicrophone=null;})
                        .setPositiveButton("Allow",(d,w)->{
                            if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED){
                                request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});pendingMicrophone=null;
                            } else requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},MIC_REQUEST);
                        }).show();
                });
            }
        });
        // The one-time server export URL must be downloaded exactly once.
        // Our small JS bridge gives Android DownloadManager that first request.
        web.addJavascriptInterface(new Object(){
            @JavascriptInterface public void saveEvidence(String link){
                runOnUiThread(() -> {
                    Uri uri=Uri.parse(link);
                    if(!isSameOrigin(uri) || (uri.getPath()==null || !uri.getPath().matches("/api/admin/exports/[0-9a-f]{64}/download"))){
                        Toast.makeText(MainActivity.this,"Invalid backup link",Toast.LENGTH_LONG).show();return;
                    }
                    startDownload(uri.toString(),"bonfire-evidence-"+System.currentTimeMillis()+".zip");
                });
            }
        },"BonfireAndroid");
        web.setDownloadListener((url,agent,disposition,mime,length)-> {
            if(!isSameOrigin(Uri.parse(url))){Toast.makeText(this,"Blocked download from another site",Toast.LENGTH_LONG).show();return;}
            startDownload(url,URLUtil.guessFileName(url,disposition,mime));
        });
        if(savedInstanceState==null) web.loadUrl(baseUrl);
        else web.restoreState(savedInstanceState);
    }
    private boolean contains(String[] values,String needle){for(String s:values)if(s.equals(needle))return true;return false;}
    private boolean isSameOrigin(Uri uri){
        return uri!=null&&"https".equalsIgnoreCase(uri.getScheme())&&host!=null&&host.equalsIgnoreCase(uri.getHost())
            && Uri.parse(baseUrl).getPort()==uri.getPort();
    }
    private void startDownload(String uri,String suggested){
        if(Build.VERSION.SDK_INT<=28 && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)!=PackageManager.PERMISSION_GRANTED){
            pendingDownload=uri;requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},WRITE_REQUEST);return;
        }
        try{
            String name=suggested==null?"bonfire-download":suggested.replaceAll("[^a-zA-Z0-9._-]","_");
            if(name.isEmpty())name="bonfire-download";
            DownloadManager.Request request=new DownloadManager.Request(Uri.parse(uri));
            request.setTitle(name);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,name);
            ((DownloadManager)getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(request);
            Toast.makeText(this,"Downloading to Downloads",Toast.LENGTH_LONG).show();
        }catch(Exception e){Toast.makeText(this,"Download failed: "+e.getMessage(),Toast.LENGTH_LONG).show();}
    }
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
        super.onActivityResult(requestCode,resultCode,data);
        if(requestCode==FILE_PICKER&&pendingFiles!=null){
            Uri[] results=null;
            if(resultCode==RESULT_OK&&data!=null){
                if(data.getClipData()!=null){int count=data.getClipData().getItemCount();results=new Uri[count];for(int i=0;i<count;i++)results[i]=data.getClipData().getItemAt(i).getUri();}
                else if(data.getData()!=null)results=new Uri[]{data.getData()};
            }
            pendingFiles.onReceiveValue(results);pendingFiles=null;
        }
    }
    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] grantResults){
        super.onRequestPermissionsResult(requestCode,permissions,grantResults);
        boolean allowed=grantResults.length>0&&grantResults[0]==PackageManager.PERMISSION_GRANTED;
        if(requestCode==MIC_REQUEST && pendingMicrophone!=null){
            if(allowed)pendingMicrophone.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else pendingMicrophone.deny();pendingMicrophone=null;
        }
        if(requestCode==WRITE_REQUEST){String url=pendingDownload;pendingDownload=null;if(allowed&&url!=null)startDownload(url,"bonfire-download.zip");}
    }
    @Override protected void onSaveInstanceState(Bundle out){if(web!=null)web.saveState(out);super.onSaveInstanceState(out);}
    @Override public void onBackPressed(){if(web!=null&&web.canGoBack())web.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){if(web!=null){web.destroy();web=null;}super.onDestroy();}
}

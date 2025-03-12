# Deploy Friendli Container as AWS EKS Add-on

[**Friendli Container**](https://aws.amazon.com/marketplace/pp/prodview-t553kwpgovrki) is a AWS Marketplace product of the [Friendli Container](https://friendli.ai/products/container).

We will walk you through setting up an EKS cluster, deploying Friendli Container, and provide the expected output for each step. By following these steps, you will have a working inference service successfully deployed on your EKS cluster.

## 1️⃣ Add GPU Node Group to your EKS Cluster

You need an active AWS EKS cluster. To create a cluster, consult [the AWS EKS documentation on creating EKS cluster](https://docs.aws.amazon.com/en_us/eks/latest/userguide/create-cluster-auto.html).

> [!NOTE]
> Friendli Container EKS-addon requires Kubernetes version 1.28 or later.

When selecting the AWS region for your new EKS cluster, availability of GPU instances is one of the key factors to consider. Friendli Container supports NVIDIA H100, A100, A10G, and L4 devices. You can check instance availability [here](https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-regions.html).

| NVIDIA Device | AWS EC2 Instance Type                                         |
| ------------- | ------------------------------------------------------------- |
| H100          | [p5.48xlarge](https://aws.amazon.com/ec2/instance-types/p5/)  |
| A100          | [p4d.24xlarge](https://aws.amazon.com/ec2/instance-types/p4/) |
| A10G          | [G5 instances](https://aws.amazon.com/ec2/instance-types/g5/) |
| L4            | [G6 instances](https://aws.amazon.com/ec2/instance-types/g6/) |

If you’re going to use multi-GPU VM instance types, installing the NVIDIA GPU Operator is highly recommended for proper resource management. You can consult [the guide from NVIDIA GPU Operator](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/amazon-eks.html), and an example of installing a GPU operator using helm can be found [here](https://aws.amazon.com/blogs/containers/maximizing-gpu-utilization-with-nvidias-multi-instance-gpu-mig-on-amazon-eks-running-more-pods-per-gpu-for-enhanced-performance/).

Now let’s add GPU Node Group to your EKS cluster.

- Open [Amazon EKS console](https://console.aws.amazon.com/eks/home#/clusters) and choose the cluster that you want to create a node group in.
- Select the “Compute” tab and click “Add node group”.
- Configure the new node group by entering the name, Node IAM role, and other information. You can click “Create recommended role” to create IAM role. Click “Next”.
- On the next page, select “Amazon Linux 2023 (x86\_64) Nvidia” for AMI type.
- Select the appropriate instance type for the GPU device of your choice.
- Configure the disk size. It should be large enough to download the model you want to deploy.
  - To execute the example in this guide, it is recommended to set the size of the disk to 60GB.
- Configure the desired node group size.
- Go through the rest of the steps, review the changes and click “Create”.

## 2️⃣ Configure Friendli Container EKS add-on

- Open [Amazon EKS console](https://console.aws.amazon.com/eks/home#/clusters) and choose the cluster that you want to configure.
- Select the “Add-ons” tab and click “Get more add-ons”.
- Scroll down and under the section “AWS Marketplace add-ons”, search and check “Friendli Container”, and click “Next”.
- Now you’ll need an active subscription to Friendli Container. The number of license units you need to purchase is determined by the number of GPU devices you want to use for running Friendli Container.
- Click “Next”, Review your settings, and click “Create”

> [!NOTE]
> - For the details of the pricing, check [Friendli Container on AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-t553kwpgovrki).
> - For trials, custom offers, and inquiries, please visit [here](https://friendli.ai/contact) for contacts.

Now you need to allow Kubernetes ServiceAccounts to contact AWS License Manager, so that your Friendli Inference Deployments can be activated properly.

> [!NOTE]
> Before you continue, please make sure “Amazon EKS Pod Identity Agent” EKS add-on is installed in your cluster. You can click “Get more add-ons” and enable “Amazon EKS Pod Identity Agent” under the “AWS add-ons” section.

- Open [Amazon EKS console](https://console.aws.amazon.com/eks/home#/clusters) and choose the cluster that you want to configure.
- Select the “Access” tab.
- Under the “Pod Identity associations” section, click “Create”.

“Create Pod Identity association” page will appear. Now let’s configure the IAM role, Kubernetes namespace, and Kubernetes service account.

- IAM Role
  - Click “Create recommended role”.
  - In step 1 (Select trusted entity), “EKS - Pod Identity” should be selected for the use case. Leave it as is and click “Next”.
  - In step 2 (Add permissions), search for “AWSLicenseManagerConsumptionPolicy” and enable it. Click “Next”.
  - In step 3 (Name, review, and create), give the appropriate Role name and click “Create”.
  - Go back to the “Create Pod Identity association” page and select the IAM role you just created.
- Kubernetes namespace.
  - This is the Kubernetes namespace where you want to create Friendli Inference Deployments. When in doubt, you can use “default”.
  - Later on, if you are going to create Friendli Inference Deployments in another namespace, you should create the Pod Identity association for that namespace.
- Kubernetes service account.
  - For most cases, this should be “default”.
  - Later on, if you are going to configure Friendli Inference Deployments to use custom service accounts, you should create the Pod Identity association for that service account.

Click “Create”, then under the “Pod Identity associations” section, you should be able to see the association you just created.

## 3️⃣ Create Friendli Deployment

> [!NOTE]
> You need to be able to use the “kubectl” CLI tool to access your EKS cluster. Consult [this guide from AWS](https://docs.aws.amazon.com/en_us/eks/latest/userguide/create-kubeconfig.html) for more details.

> [!NOTE]
> To deploy a private or gated model in the HuggingFace model hub, you need to [create a HuggingFace access token](https://huggingface.co/settings/tokens) with “read” permission.
>
> Then create a Kubernetes secret.
>
> `kubectl create secret generic hf-secret --from-literal token=YOUR_TOKEN_HERE`

FriendliDeployment is Kubernetes custom resource that lets you easily create Friendli Inference Deployments without configuring Kubernetes low-level resources like pods, services, and deployments.

Below is a sample FriendlDeployment to deploy [Meta Llama 3.1 8b](https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct) on one g6.2xlarge instance.

```yaml
apiVersion: friendli.ai/v1alpha1
kind: FriendliDeployment
metadata:
  namespace: default
  name: friendlideployment-sample
spec:
  model:
    huggingFace:
      repository: meta-llama/Llama-3.1-8B-Instruct

      # "token:" section is not needed if the model is
      # a public one.
      token:
        name: hf-secret
        key: token

  resources:

    nodeSelector:
      # Use the name of the node group you want to use.
      eks.amazonaws.com/nodegroup: gpu-l4

    numGPUs: 1
    requests:
      cpu: "6"
      ephemeral-storage: 30Gi
      memory: 25Gi
    limits:
      cpu: "6"
      ephemeral-storage: 30Gi
      memory: 25Gi
  deploymentStrategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 0
      maxUnavailable: 1
  service:
    inferencePort: 6000
```

You can modify this YAML file for your use case.

- The “token:” section under spec.model.huggingFace refers to the Kubernetes secret you created for storing the HuggingFace access token. If accessing your model does not require an access token, you can omit the “token:” section entirely.
- In the example above, nodeSelector is “eks.amazonaws.com/nodegroup: gpu-l4”. This assumes that the name of the GPU node group is “gpu-l4”. You need to edit the node selector to match the name of your node group.
- CPU and memory resource requirements are adjusted to g6.2xlarge instance and you may need to edit those values if you used different instance type.

> [!NOTE]
> If your cluster has NVIDIA GPU Operator installed, you need to put “nvidia.com/gpu” resource in “requests:” and “limits:” section, as GPU nodes will advertise that they have “nvidia.com/gpu” resource alongside ordinary resources like “cpu” and “memory”. You can omit “numGPUs” from your FriendliDeployment.
>
> Below is the equivalent example as above for the GPU Operator-enabled cluster.

```yaml
  resources:
    nodeSelector:
      eks.amazonaws.com/nodegroup: gpu-l4
    requests:
      cpu: "6"
      ephemeral-storage: 30Gi
      memory: 25Gi
      nvidia.com/gpu: "1"
    limits:
      cpu: "6"
      ephemeral-storage: 30Gi
      memory: 25Gi
      nvidia.com/gpu: "1"
```

Save your YAML file as “friendlideployment.yaml”, and execute `kubectl apply -f friendlideployment.yaml`

```
$ kubectl apply -f friendlideployment.yaml
friendlideployment.friendli.ai/friendlideployment-sample created

$ kubectl get pods -n default
NAME                                         READY   STATUS    RESTARTS   AGE
friendlideployment-sample-7d7b877c77-zjgqq   2/2     Running   0          3m18s

$ kubectl get services -n default
NAME                        TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)    AGE
friendlideployment-sample   ClusterIP   172.20.95.224   <none>        6000/TCP   18m
kubernetes                  ClusterIP   172.20.0.1      <none>        443/TCP    28h
```

Now you can [port-forward](https://kubernetes.io/docs/tasks/access-application-cluster/port-forward-access-application-cluster/) to the service to connect to the service from your PC.

```
$ kubectl port-forward -n default svc/friendlideployment-sample 6000
Forwarding from 127.0.0.1:6000 -> 6000
Forwarding from [::1]:6000 -> 6000
```

In another terminal, use the curl tool to send an inference request.

```
$ curl http://localhost:6000/v1/completions -H 'Content-Type: application/json' --data-raw '{"prompt": "Hi!", max_tokens: 10, stream: false}'
{"choices":[{"finish_reason":"length","index":0,"seed":15349211611234757311,"text":" I'm Alex, and I'm excited to share","tokens":[358,2846,8683,11,323,358,2846,12304,311,4430]}],"id":"cmpl-b2e4b4cba711448c847ab89d763588da","object":"text_completion","usage":{"completion_tokens":10,"prompt_tokens":3,"total_tokens":13}}
```

For more information about Friendli Container usage, check [our documentation](https://friendli.ai/docs/guides/container/introduction) and [contact us](http://friendli.ai/contact) for inquiries.

## Cleaning up

You can remove the FriendliDeployment using the kubectl CLI tool.

```
$ kubectl delete friendlideployment -n default friendlideployment-sample
friendlideployment.friendli.ai "friendlideployment-sample" deleted
```

You may also want to scale down or delete your GPU node group to avoid being charged for unused GPU instances.
